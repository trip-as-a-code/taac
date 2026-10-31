/**
 * GitHub pictures for the trip's people, fetched here and kept, so browsers
 * never call GitHub. A default identicon counts as no picture: the site then
 * keeps the member's initials.
 */

import { inflateSync } from 'node:zlib'

import type { AccessManifest } from './access'

export interface Avatar {
  /** Null when there is no picture of their own. */
  type: string | null
  image: Uint8Array | null
  fetchedAt: number
}

export interface AvatarStore {
  avatar(login: string): Promise<Avatar | null>
  putAvatar(login: string, avatar: Avatar): Promise<void>
}

const TTL_MS = 24 * 60 * 60 * 1000
const SIZE = 96
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** The light grey around every identicon's 5×5 pattern. */
const IDENTICON_GROUND = [0xf0, 0xf0, 0xf0]

export function avatarLogin(path: string): string | null {
  const match = /^\/api\/avatars\/([^/]+)$/.exec(path)
  const login = match?.[1]?.toLowerCase()
  return login && LOGIN.test(login) ? login : null
}

/** The viewer may see this person's picture: they are on one of the trips the viewer can see. */
export function mayShowAvatar(login: string, trips: string[], manifest: AccessManifest): boolean {
  return trips.some((slug) => manifest.trips[slug]?.logins.includes(login))
}

/** RGB(A) pixels of an 8-bit, non-interlaced PNG, or null for anything else. */
function decodePng(bytes: Uint8Array): { width: number; height: number; channels: number; pixels: Uint8Array } | null {
  if (!PNG.every((b, i) => bytes[i] === b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const data: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, colour, , , interlace] = body.subarray(8, 13)
      channels = colour === 2 ? 3 : colour === 6 ? 4 : 0
      if (depth !== 8 || interlace !== 0 || !channels) return null
    } else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    at += 12 + length
  }
  if (!width || !height || width * height > 1024 * 1024) return null
  let raw: Uint8Array
  try {
    raw = inflateSync(Buffer.concat(data))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < height * (stride + 1)) return null
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels]! : 0
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels]! : 0
      const predictor =
        filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0
      pixels[y * stride + x] = (line[x]! + predictor) & 0xff
    }
  }
  return { width, height, channels, pixels }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** GitHub's default picture: two flat colours, the corners the identicon grey. */
export function isIdenticon(bytes: Uint8Array): boolean {
  const png = decodePng(bytes)
  if (!png) return false
  const { channels, pixels } = png
  if (!IDENTICON_GROUND.every((v, i) => pixels[i] === v)) return false
  const colours = new Set<number>()
  for (let at = 0; at < pixels.length; at += channels) {
    colours.add((pixels[at]! << 16) | (pixels[at + 1]! << 8) | pixels[at + 2]!)
    if (colours.size > 2) return false
  }
  return true
}

/** The picture of a GitHub account, null for a default one or no account; throws when GitHub can't be reached. */
export async function fetchAvatar(login: string, fetcher: typeof fetch, now: number): Promise<Avatar> {
  const response = await fetcher(`https://github.com/${login}.png?size=${SIZE}`, { redirect: 'follow' })
  if (response.status === 404) return { type: null, image: null, fetchedAt: now }
  if (!response.ok) throw new Error(`github ${response.status}`)
  const type = response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? ''
  const image = new Uint8Array(await response.arrayBuffer())
  if (!/^image\/(png|jpeg|gif|webp)$/.test(type) || isIdenticon(image))
    return { type: null, image: null, fetchedAt: now }
  return { type, image, fetchedAt: now }
}

/** Pictures by login: kept in the store (or memory) for a day, the last one served while GitHub is away. */
export function avatarSource(store: AvatarStore | undefined, fetcher: typeof fetch) {
  const memory = new Map<string, Avatar>()
  const pending = new Map<string, Promise<Avatar | null>>()
  const kept = async (login: string) => memory.get(login) ?? (await store?.avatar(login).catch(() => null)) ?? null

  async function refresh(login: string, now: number, old: Avatar | null): Promise<Avatar | null> {
    try {
      const fresh = await fetchAvatar(login, fetcher, now)
      memory.set(login, fresh)
      await store?.putAvatar(login, fresh).catch(() => undefined)
      return fresh
    } catch {
      return old
    }
  }

  return async (login: string, now: number): Promise<Avatar | null> => {
    const old = await kept(login)
    if (old && now - old.fetchedAt < TTL_MS) return old
    let job = pending.get(login)
    if (!job) {
      job = refresh(login, now, old).finally(() => pending.delete(login))
      pending.set(login, job)
    }
    return job
  }
}
