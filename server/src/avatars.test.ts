import { deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { normalise } from './access'
import { avatarLogin, avatarSource, isIdenticon, mayShowAvatar } from './avatars'

/** A PNG of `size`² pixels painted by `paint`, every row with the Up filter. */
function png(size: number, channels: 3 | 4, paint: (x: number, y: number) => number[]): Uint8Array {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length)
    head.write(type, 4, 'ascii')
    return Buffer.concat([head, body, Buffer.alloc(4)])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, channels === 3 ? 2 : 6, 0, 0, 0], 8)
  const stride = size * channels
  const raw = Buffer.alloc(size * (stride + 1))
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < size; y++) {
    const row = Buffer.from(Array.from({ length: size }, (_, x) => paint(x, y).slice(0, channels)).flat())
    raw[y * (stride + 1)] = 2
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (row[i]! - previous[i]!) & 0xff
    previous = row
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return new Uint8Array(
    Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]),
  )
}

/** Like GitHub's: a 5×5 pattern in one colour on the identicon grey. */
const identicon = png(420, 3, (x, y) => {
  const cell = (v: number) => Math.floor((v - 35) / 70)
  const on = x >= 35 && y >= 35 && x < 385 && y < 385 && (cell(x) + cell(y)) % 2 === 0
  return on ? [0x6c, 0xc6, 0x44] : [0xf0, 0xf0, 0xf0]
})
const photo = png(96, 3, (x, y) => [0xf0, 0xf0 - x, 0xf0 - y])
const photoWithAlpha = png(96, 4, (x, y) => [x * 2, y * 2, 128, 255])

describe('identicons', () => {
  it('tells GitHub’s default picture from a real one', () => {
    expect(isIdenticon(identicon)).toBe(true)
    expect(isIdenticon(photo)).toBe(false)
    expect(isIdenticon(photoWithAlpha)).toBe(false)
    expect(isIdenticon(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false)
  })
})

describe('who may see whose picture', () => {
  const manifest = normalise({
    auth: 'github',
    trips: {
      japan: { title: 'Japan', public: false, logins: ['alex', 'sam'] },
      lisbon: { title: 'Lisbon', public: true, logins: ['robin'] },
    },
    slugs: ['japan', 'lisbon'],
  })

  it('shows the people of the trips the viewer can see', () => {
    expect(mayShowAvatar('sam', 'alex', manifest)).toBe(true)
    expect(mayShowAvatar('sam', null, manifest)).toBe(false)
    expect(mayShowAvatar('sam', 'stranger', manifest)).toBe(false)
    expect(mayShowAvatar('robin', null, manifest)).toBe(true)
    expect(mayShowAvatar('torvalds', 'alex', manifest)).toBe(false)
  })

  it('reads only usernames from the path', () => {
    expect(avatarLogin('/api/avatars/Alex')).toBe('alex')
    expect(avatarLogin('/api/avatars/../etc')).toBeNull()
    expect(avatarLogin('/api/avatars/-x')).toBeNull()
  })
})

describe('keeping pictures', () => {
  function github(responses: (() => Response)[]) {
    let calls = 0
    const fetcher = (async () => responses[Math.min(calls++, responses.length - 1)]!()) as unknown as typeof fetch
    return { fetcher, calls: () => calls }
  }
  const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } })
  const day = 24 * 60 * 60 * 1000

  it('keeps a picture for a day, and the old one while GitHub is away', async () => {
    const gh = github([jpeg, () => new Response('down', { status: 502 })])
    const avatar = avatarSource(undefined, gh.fetcher)
    expect((await avatar('alex', 0))?.type).toBe('image/jpeg')
    expect((await avatar('alex', day - 1))?.type).toBe('image/jpeg')
    expect(gh.calls()).toBe(1)
    expect((await avatar('alex', day + 1))?.type).toBe('image/jpeg')
    expect(gh.calls()).toBe(2)
  })

  it('counts an identicon and a missing account as no picture', async () => {
    const grey = () => new Response(identicon, { headers: { 'Content-Type': 'image/png' } })
    expect((await avatarSource(undefined, github([grey]).fetcher)('x', 0))?.image).toBeNull()
    const gone = () => new Response('', { status: 404 })
    expect((await avatarSource(undefined, github([gone]).fetcher)('x', 0))?.image).toBeNull()
  })
})
