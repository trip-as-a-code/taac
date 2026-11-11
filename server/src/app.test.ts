import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'

import { normalise } from './access'
import { createHandler } from './app'
import { calendarKey } from './auth'
import type { Thread } from './comments'
import type { StoredPhoto } from './photos'
import type { PushMessage, PushSubscription } from './push'
import { works, type ShareLink } from './links'
import { merge, type Ticks } from './packing'
import type { Store } from './store'

const manifest = normalise({
  title: 'Trips',
  auth: 'github',
  trips: {
    japan: {
      title: 'Japan',
      public: false,
      logins: ['alex', 'grandma'],
      roles: { alex: 'member', grandma: 'viewer' },
    },
  },
  slugs: ['japan'],
  locales: ['en', 'ru'],
  defaultLocale: 'en',
})

let dist = ''
beforeAll(async () => {
  shrine = new Uint8Array(
    await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c33' } })
      .png()
      .toBuffer(),
  )
  dist = mkdtempSync(join(tmpdir(), 'taac-dist-'))
  mkdirSync(join(dist, 'trips/japan'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<h1>home</h1>')
  writeFileSync(join(dist, 'trips/japan/index.html'), '<h1>japan</h1>')
  writeFileSync(join(dist, 'trips/japan/calendar.ics'), 'BEGIN:VCALENDAR')
  writeFileSync(join(dist, '404.html'), '<h1>nope</h1>')
  changes([{ id: 'c1', login: 'grandma', author: 'Grandma', at: Date.now() - 1000, summary: 'Moved: Walk' }])
  mkdirSync(join(dist, '_taac'), { recursive: true })
  writeFileSync(
    join(dist, '_taac/photos.json'),
    JSON.stringify({ '0123456789abcdef': { url: 'https://pictures.example/shrine.png', trips: ['japan'] } }),
  )
  writeFileSync(
    join(dist, 'trips/japan/threads.json'),
    JSON.stringify({
      title: 'Japan',
      targets: {
        'day:2026-12-12': { title: 'Saturday', href: '/trips/japan/itinerary/#2026-12-12' },
        'item:tower': { title: 'Tokyo Tower', href: '/trips/japan/itinerary/#item-tower' },
        'task:vjw': { title: 'Entry form', href: '/trips/japan/tasks/#task-vjw' },
      },
      people: { alex: 'Alex', grandma: 'Grandma' },
    }),
  )
})

/** The build's change sets for the trip. */
function changes(sets: { id: string; login?: string; author: string; at: number; summary: string }[]) {
  writeFileSync(
    join(dist, 'trips/japan/changes.json'),
    JSON.stringify({ sets: sets.map((s) => ({ ...s, href: '/trips/japan/#changes' })) }),
  )
}

/** A 300×200 picture, as a host would serve it, and how often it was fetched. */
let shrine: Uint8Array
let photoFetches = 0

/** GitHub, answering every code with `who`. */
function github(who: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'token' })
    if (url.endsWith('/user')) return Response.json({ login: who })
    if (url === 'https://pictures.example/shrine.png') {
      photoFetches++
      return new Response(shrine, { headers: { 'Content-Type': 'image/png' } })
    }
    if (url.startsWith('https://github.com/alex.png'))
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
}

function memoryStore(): Store {
  const trips = new Map<string, Ticks>()
  const links: ShareLink[] = []
  const threads: Thread[] = []
  const findComment = (id: string) => {
    for (const t of threads) for (const c of t.comments) if (c.id === id) return { thread: t, comment: c }
    return null
  }
  let seen = 0
  const marks = new Map<string, boolean>()
  const subscriptions: PushSubscription[] = []
  const langs = new Map<string, string>()
  const mutes = new Map<string, string[]>()
  const announced = new Map<string, Set<string>>()
  const pictures = new Map<string, StoredPhoto>()
  const reminders = new Map<string, { timeZone: string | null; remindAt: string | null }>()
  const claimed = new Map<string, { date: string; rung: number }>()
  return {
    userReminders: async (login) => reminders.get(login) ?? { timeZone: null, remindAt: null },
    setUserReminders: async (login, { timeZone, remindAt }) => {
      const was = reminders.get(login)
      reminders.set(login, { timeZone: timeZone ?? was?.timeZone ?? null, remindAt: remindAt ?? was?.remindAt ?? null })
    },
    claimReminder: async (login, key, date, rung) => {
      const was = claimed.get(`${login}|${key}`)
      if (was && was.date === date && was.rung <= rung) return false
      claimed.set(`${login}|${key}`, { date, rung })
      return true
    },
    photo: async (id, size) => pictures.get(`${id}/${size}`) ?? null,
    putPhoto: async (id, size, photo) => void pictures.set(`${id}/${size}`, photo),
    userMuted: async (login) => mutes.get(login) ?? [],
    setUserMuted: async (login, muted) => void mutes.set(login, muted),
    unannounced: async (trip, ids) => {
      const known = announced.get(trip) ?? new Set<string>()
      const first = known.size === 0
      const fresh = ids.filter((id) => !known.has(id))
      announced.set(trip, new Set([...known, ...ids]))
      return { fresh, first }
    },
    userLang: async (login) => langs.get(login) ?? null,
    setUserLang: async (login, lang) => void langs.set(login, lang),
    addSubscription: async (sub) => void subscriptions.push(sub),
    removeSubscription: async (endpoint) => {
      subscriptions.splice(0, subscriptions.length, ...subscriptions.filter((s) => s.endpoint !== endpoint))
    },
    subscriptionsFor: async (logins) => subscriptions.filter((s) => logins.includes(s.login)),
    notificationsSeen: async () => seen,
    markNotificationsSeen: async (_login, at) => {
      seen = Math.max(seen, at)
      marks.clear()
    },
    notificationMarks: async () => new Map(marks),
    markNotifications: async (_login, ids, read) => {
      for (const id of ids) marks.set(id, read)
    },
    threads: async (trip) => structuredClone(threads.filter((t) => t.trip === trip)),
    moveAnchor: async (trip, from, to) => {
      const moving = threads.filter((t) => t.trip === trip && t.anchor === from)
      for (const t of moving) t.anchor = to
      return moving.length
    },
    thread: async (id) => structuredClone(threads.find((t) => t.id === id) ?? null),
    createThread: async (thread) => void threads.push(structuredClone(thread)),
    addComment: async (id, comment) => void threads.find((t) => t.id === id)?.comments.push(comment),
    resolveThread: async (id, by, now) => {
      const t = threads.find((x) => x.id === id)!
      Object.assign(t, { resolvedBy: by, resolvedAt: by === null ? null : now })
    },
    editComment: async (id, body, now) => void Object.assign(findComment(id)!.comment, { body, editedAt: now }),
    deleteComment: async (id, now) => void Object.assign(findComment(id)!.comment, { body: '', deletedAt: now }),
    comment: async (id) => {
      const found = findComment(id)
      return found ? { ...found.comment, trip: found.thread.trip } : null
    },
    createLink: async (link) => void links.push(link),
    links: async (trip, now) => links.filter((l) => l.trip === trip && works(l, now)),
    linkByToken: async (token) => links.find((l) => l.token === token) ?? null,
    linkById: async (id) => links.find((l) => l.id === id) ?? null,
    revokeLink: async (trip, id, by, now) => {
      const link = links.find((l) => l.trip === trip && l.id === id && l.revokedAt === null)
      if (!link) return false
      Object.assign(link, { revokedAt: now, revokedBy: by })
      return true
    },
    touchLink: async (id, now) => {
      const link = links.find((l) => l.id === id)
      if (link) link.lastUsedAt = now
    },
    ticks: async (trip) => trips.get(trip) ?? {},
    avatar: async () => null,
    putAvatar: async () => undefined,
    apply: async (trip, changes, now, by) => {
      const ticks = trips.get(trip) ?? {}
      merge(ticks, changes, now, by)
      trips.set(trip, ticks)
    },
    close: async () => undefined,
  }
}

function handler(
  who = 'Alex',
  store = memoryStore(),
  now?: () => number,
  push?: { publicKey: string; send: (s: PushSubscription, m: PushMessage) => Promise<'ok' | 'gone' | 'failed'> },
) {
  return createHandler(
    {
      now,
      push,
      dist,
      publicUrl: 'https://trips.example',
      sessionSecret: 'secret',
      github: { clientId: 'id', clientSecret: 'shh' },
      store,
      fetcher: github(who),
    },
    manifest,
  )
}

const page = { Accept: 'text/html' }

/** Signs in through the GitHub round trip; returns the cookies to send. */
async function signIn(handle: ReturnType<typeof handler>): Promise<string> {
  const start = await handle(new Request('https://trips.example/api/auth/github?next=/trips/japan/'))
  expect(start.status).toBe(302)
  const location = new URL(start.headers.get('Location')!)
  expect(location.origin).toBe('https://github.com')
  expect(location.searchParams.get('redirect_uri')).toBe('https://trips.example/api/auth/callback')
  const state = location.searchParams.get('state')!
  const stateCookie = start.headers.getSetCookie()[0]!.split(';')[0]!
  const back = await handle(
    new Request(`https://trips.example/api/auth/callback?code=c&state=${state}`, { headers: { Cookie: stateCookie } }),
  )
  expect(back.status).toBe(303)
  expect(back.headers.get('Location')).toBe('/trips/japan/')
  return back.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')
}

describe('signing in', () => {
  it('sends the signed-out to the sign-in page, then lets a member in', async () => {
    const handle = handler()
    const first = await handle(new Request('https://trips.example/trips/japan/', { headers: page }))
    expect(first.status).toBe(302)
    expect(first.headers.get('Location')).toBe('/login?next=%2Ftrips%2Fjapan%2F')
    const login = await handle(new Request('https://trips.example/login?next=/trips/japan/', { headers: page }))
    const loginPage = await login.text()
    expect(loginPage).toContain('/api/auth/github?next=%2Ftrips%2Fjapan%2F')
    // The site's icon, which needs no sign-in to load.
    expect(loginPage).toContain('<link rel="icon" href="/favicon.svg"')
    expect((await handle(new Request('https://trips.example/favicon.svg'))).status).not.toBe(302)
    // The site's language and theme switches, each language keeping where to go next.
    expect(loginPage).toContain('href="/ru/login?next=/trips/japan/" hreflang="ru"')
    expect(loginPage).toContain('href="/login?next=/trips/japan/" hreflang="en"')
    expect(loginPage).toContain('data-theme-toggle')
    expect(loginPage).not.toContain('data-switches data-account')

    const cookies = await signIn(handle)
    expect(cookies).toContain('taac_signed_in=1')
    const trip = await handle(
      new Request('https://trips.example/trips/japan/', { headers: { ...page, Cookie: cookies } }),
    )
    expect(trip.status).toBe(200)
    expect(await trip.text()).toBe('<h1>japan</h1>')
    const me = await handle(new Request('https://trips.example/api/me', { headers: { Cookie: cookies } }))
    expect(await me.json()).toEqual({
      login: 'alex',
      trips: ['japan'],
      packing: ['japan'],
      share: ['japan'],
      comments: ['japan'],
      link: null,
      push: null,
      lang: null,
      muted: [],
      timeZone: null,
      remindAt: null,
      calendars: { japan: await calendarKey('secret', 'japan') },
    })
  })

  it('refuses a forged state', async () => {
    const handle = handler()
    const back = await handle(
      new Request('https://trips.example/api/auth/callback?code=c&state=forged', {
        headers: { Cookie: 'taac_oauth=real|%2F' },
      }),
    )
    expect(back.status).toBe(303)
    expect(back.headers.get('Location')).toContain('error=1')
  })

  it('tells someone who isn’t on the trip, and offers another account', async () => {
    const handle = handler('stranger')
    const cookies = await signIn(handle)
    const trip = await handle(
      new Request('https://trips.example/trips/japan/', { headers: { ...page, Cookie: cookies } }),
    )
    expect(trip.status).toBe(403)
    const body = await trip.text()
    expect(body).toContain('<strong>@stranger</strong>')
    expect(body).toContain('action="/api/logout"')
    // Signed in, a language switch goes to the account.
    expect(body).toContain('data-switches data-account')
    expect(body).toContain('href="/ru/trips/japan/" hreflang="ru"')
  })

  it('signs out', async () => {
    const out = await handler()(new Request('https://trips.example/api/logout', { method: 'POST' }))
    expect(out.status).toBe(303)
    expect(out.headers.getSetCookie().join()).toContain('taac_session=;')
  })
})

describe('the rest', () => {
  it('opens calendar feeds with their key, and nothing else', async () => {
    const handle = handler()
    const key = await calendarKey('secret', 'japan')
    const feed = await handle(new Request(`https://trips.example/trips/japan/calendar.ics?key=${key}`))
    expect(feed.status).toBe(200)
    expect(feed.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect((await handle(new Request('https://trips.example/trips/japan/calendar.ics?key=wrong'))).status).toBe(401)
  })

  it('keeps packing ticks for the trip’s people', async () => {
    const handle = handler()
    const cookies = await signIn(handle)
    const url = 'https://trips.example/trips/japan/_packing'
    const changes = [{ item: 'adapter', member: 'alex', packed: true, at: 1 }]
    await handle(new Request(url, { method: 'POST', headers: { Cookie: cookies }, body: JSON.stringify({ changes }) }))
    const read = await handle(new Request(url, { headers: { Cookie: cookies } }))
    expect(await read.json()).toEqual({ ticks: { 'adapter|alex': { packed: true, at: 1, by: 'alex' } } })
    expect((await handle(new Request(url))).status).toBe(401)
  })

  it('lets viewers read the packing list but not tick it', async () => {
    const handle = handler('grandma')
    const cookies = await signIn(handle)
    const url = 'https://trips.example/trips/japan/_packing'
    expect((await handle(new Request(url, { headers: { Cookie: cookies } }))).status).toBe(200)
    const changes = [{ item: 'adapter', member: 'alex', packed: true, at: 1 }]
    const post = await handle(
      new Request(url, { method: 'POST', headers: { Cookie: cookies }, body: JSON.stringify({ changes }) }),
    )
    expect(post.status).toBe(403)
    const me = await handle(new Request('https://trips.example/api/me', { headers: { Cookie: cookies } }))
    expect(((await me.json()) as { packing: string[] }).packing).toEqual([])
  })

  it('serves clean URLs, redirects to the slash, falls back to the 404 page, and stays inside', async () => {
    const handle = handler()
    const cookies = await signIn(handle)
    const get = (path: string) =>
      handle(new Request(`https://trips.example${path}`, { headers: { ...page, Cookie: cookies } }))
    expect((await get('/trips/japan')).headers.get('Location')).toBe('/trips/japan/')
    const missing = await get('/trips/japan/nope/')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('<h1>nope</h1>')
    expect((await get('/%2e%2e/%2e%2e/etc/passwd')).status).toBe(404)
    expect((await handle(new Request('https://trips.example/healthz'))).status).toBe(200)
  })

  it('shows the trip’s people’s pictures to those who see the trip', async () => {
    const handle = handler()
    const anonymous = await handle(new Request('https://trips.example/api/avatars/Alex'))
    expect(anonymous.status).toBe(404)
    const cookies = await signIn(handle)
    const picture = await handle(
      new Request('https://trips.example/api/avatars/Alex', { headers: { Cookie: cookies } }),
    )
    expect(picture.status).toBe(200)
    expect(picture.headers.get('Content-Type')).toBe('image/jpeg')
    const stranger = await handle(
      new Request('https://trips.example/api/avatars/torvalds', { headers: { Cookie: cookies } }),
    )
    expect(stranger.status).toBe(404)
  })

  it('sets the security headers everywhere', async () => {
    const response = await handler()(new Request('https://trips.example/healthz'))
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })
})

describe('view-only links', () => {
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .join('; ')

  async function makeLink(store: Store, expires = '1w', now?: () => number) {
    const member = handler('Alex', store, now)
    const cookies = await signIn(member)
    const made = await member(
      new Request('https://trips.example/api/trips/japan/links', {
        method: 'POST',
        headers: { Cookie: cookies },
        body: JSON.stringify({ label: 'for mum', expires }),
      }),
    )
    expect(made.status).toBe(200)
    const [link] = ((await made.json()) as { links: { id: string; url: string; createdBy: string }[] }).links
    expect(link!.createdBy).toBe('alex')
    return { member, cookies, link: link! }
  }

  it('shows its trip, read-only, to anyone holding it', async () => {
    const store = memoryStore()
    const { link } = await makeLink(store)
    const visitor = handler('nobody', store)
    const opened = await visitor(new Request(link.url, { headers: { ...page, Cookie: 'taac_lang=ru' } }))
    expect(opened.status).toBe(303)
    expect(opened.headers.get('Location')).toBe('/ru/trips/japan/')
    const cookie = cookieOf(opened)
    const get = (path: string) =>
      visitor(new Request(`https://trips.example${path}`, { headers: { ...page, Cookie: cookie } }))
    expect((await get('/trips/japan/')).status).toBe(200)
    expect((await get('/')).headers.get('Location')).toBe('/trips/japan/')
    const me = (await (await get('/api/me')).json()) as { trips: string[]; packing: string[]; link: { label: string } }
    expect(me.trips).toEqual(['japan'])
    expect(me.packing).toEqual([])
    expect(me.link.label).toBe('for mum')
    const tick = await visitor(
      new Request('https://trips.example/trips/japan/_packing', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: JSON.stringify({ changes: [{ item: 'a', member: 'alex', packed: true, at: 1 }] }),
      }),
    )
    expect(tick.status).toBe(403)
    expect((await get('/api/trips/japan/links')).status).toBe(401)
  })

  it('stops working once any member revokes it', async () => {
    const store = memoryStore()
    const { member, cookies, link } = await makeLink(store)
    const visitor = handler('nobody', store)
    const cookie = cookieOf(await visitor(new Request(link.url)))
    const revoked = await member(
      new Request(`https://trips.example/api/trips/japan/links/${link.id}`, {
        method: 'DELETE',
        headers: { Cookie: cookies },
      }),
    )
    expect(((await revoked.json()) as { links: unknown[] }).links).toEqual([])
    const trip = await visitor(
      new Request('https://trips.example/trips/japan/', { headers: { ...page, Cookie: cookie } }),
    )
    expect(trip.status).toBe(302)
    expect((await visitor(new Request(link.url))).status).toBe(410)
  })

  it('expires', async () => {
    const store = memoryStore()
    let now = Date.now()
    const { link } = await makeLink(store, '1d', () => now)
    now += 2 * 24 * 60 * 60 * 1000
    const gone = await handler('nobody', store, () => now)(new Request(link.url))
    expect(gone.status).toBe(410)
    // One address in every language: the switch sets the cookie and reloads it.
    expect(await gone.text()).toContain(`href="${new URL(link.url).pathname}" hreflang="ru"`)
  })

  it('is made by members only', async () => {
    const viewer = handler('grandma')
    const cookies = await signIn(viewer)
    const made = await viewer(
      new Request('https://trips.example/api/trips/japan/links', {
        method: 'POST',
        headers: { Cookie: cookies },
        body: JSON.stringify({ label: 'x', expires: 'never' }),
      }),
    )
    expect(made.status).toBe(403)
  })
})

describe('discussions', () => {
  const api = 'https://trips.example/api/trips/japan'
  const send = (handle: ReturnType<typeof handler>, cookies: string, path: string, method: string, body?: unknown) =>
    handle(
      new Request(`${api}${path}`, {
        method,
        headers: { Cookie: cookies },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  const threadsOf = async (response: Response) => ((await response.json()) as { threads: Thread[] }).threads

  it('takes anchors in any script, and follows a renamed plan to its new one', async () => {
    const store = memoryStore()
    const member = handler('Alex', store)
    const mine = await signIn(member)
    for (const anchor of ['item:прогулка-у-пруда', 'item:東京タワー', 'item:café-crème'])
      expect((await send(member, mine, '/threads', 'POST', { anchor, body: 'Hi' })).status).toBe(200)
    for (const anchor of ['item:a b', 'item:<x>', '1item', 'item:"q"'])
      expect((await send(member, mine, '/threads', 'POST', { anchor, body: 'Hi' })).status).toBe(400)

    // The build saw `прогулка-у-пруда` renamed to `evening-walk`: its discussion follows.
    const described = join(dist, 'trips/japan/threads.json')
    const before = readFileSync(described, 'utf8')
    writeFileSync(
      described,
      JSON.stringify({ ...JSON.parse(before), moved: { 'item:прогулка-у-пруда': 'item:evening-walk' } }),
    )
    try {
      await handler('nobody', store).moveAnchors()
    } finally {
      writeFileSync(described, before)
    }
    const anchors = (await threadsOf(await send(member, mine, '/threads', 'GET'))).map((t) => t.anchor)
    expect(anchors).toEqual(['item:evening-walk', 'item:東京タワー', 'item:café-crème'])
  })

  it('lets the trip’s people start threads, reply, resolve, edit and delete their own words', async () => {
    const store = memoryStore()
    const member = handler('Alex', store)
    const mine = await signIn(member)
    const viewer = handler('grandma', store)
    const theirs = await signIn(viewer)

    let threads = await threadsOf(
      await send(member, mine, '/threads', 'POST', { anchor: 'day:2026-12-11', body: ' Walk? ' }),
    )
    expect(threads).toHaveLength(1)
    const [thread] = threads
    expect(thread!.comments[0]).toMatchObject({ author: 'alex', body: 'Walk?' })

    threads = await threadsOf(await send(viewer, theirs, `/threads/${thread!.id}/comments`, 'POST', { body: 'Yes' }))
    expect(threads[0]!.comments.map((c) => c.author)).toEqual(['alex', 'grandma'])
    const reply = threads[0]!.comments[1]!

    expect((await send(member, mine, `/comments/${reply.id}`, 'PATCH', { body: 'No' })).status).toBe(403)
    threads = await threadsOf(await send(viewer, theirs, `/comments/${reply.id}`, 'PATCH', { body: 'Yes!' }))
    expect(threads[0]!.comments[1]).toMatchObject({ body: 'Yes!' })
    expect(threads[0]!.comments[1]!.editedAt).not.toBeNull()

    threads = await threadsOf(await send(viewer, theirs, `/threads/${thread!.id}`, 'PATCH', { resolved: true }))
    expect(threads[0]).toMatchObject({ resolvedBy: 'grandma' })
    threads = await threadsOf(await send(member, mine, `/threads/${thread!.id}`, 'PATCH', { resolved: false }))
    expect(threads[0]).toMatchObject({ resolvedBy: null, resolvedAt: null })

    threads = await threadsOf(await send(viewer, theirs, `/comments/${reply.id}`, 'DELETE'))
    expect(threads[0]!.comments[1]).toMatchObject({ body: '' })
    expect(threads[0]!.comments[1]!.deletedAt).not.toBeNull()
  })

  it('refuses bad anchors, empty words, and strangers', async () => {
    const member = handler()
    const cookies = await signIn(member)
    expect((await send(member, cookies, '/threads', 'POST', { anchor: '../x', body: 'hi' })).status).toBe(400)
    expect((await send(member, cookies, '/threads', 'POST', { anchor: 'trip', body: '   ' })).status).toBe(400)
    expect((await member(new Request(`${api}/threads`))).status).toBe(401)
    const stranger = handler('stranger')
    expect((await send(stranger, await signIn(stranger), '/threads', 'GET')).status).toBe(403)
  })

  it('shows link holders the threads, read-only', async () => {
    const store = memoryStore()
    const member = handler('Alex', store)
    const cookies = await signIn(member)
    await send(member, cookies, '/threads', 'POST', { anchor: 'trip', body: 'Hello' })
    const made = await send(member, cookies, '/links', 'POST', { label: '', expires: '1d' })
    const [link] = ((await made.json()) as { links: { url: string }[] }).links
    const visitor = handler('nobody', store)
    const opened = await visitor(new Request(link!.url))
    const cookie = opened.headers.getSetCookie()[0]!.split(';')[0]!
    expect(await threadsOf(await send(visitor, cookie, '/threads', 'GET'))).toHaveLength(1)
    expect((await send(visitor, cookie, '/threads', 'POST', { anchor: 'trip', body: 'x' })).status).toBe(403)
  })
})

describe('notifications', () => {
  it('tells each member what the others said and settled, and remembers how far they read', async () => {
    const store = memoryStore()
    // Only discussions here; the plan's changes have their own test.
    await store.setUserMuted('alex', ['change'])
    const me = handler('Alex', store)
    const mine = await signIn(me)
    const viewer = handler('grandma', store)
    const theirs = await signIn(viewer)
    const post = (handle: ReturnType<typeof handler>, cookies: string, path: string, body: unknown, method = 'POST') =>
      handle(
        new Request(`https://trips.example/api/trips/japan${path}`, {
          method,
          headers: { Cookie: cookies },
          body: JSON.stringify(body),
        }),
      )
    const threads = (await (await post(me, mine, '/threads', { anchor: 'trip', body: 'Ideas?' })).json()) as {
      threads: Thread[]
    }
    const id = threads.threads[0]!.id
    await post(viewer, theirs, `/threads/${id}/comments`, { body: 'Onsen!' })
    await post(viewer, theirs, `/threads/${id}`, { resolved: true }, 'PATCH')

    type Listed = { unread: number; notifications: { id: string; kind: string; by: string; read: boolean }[] }
    const list = async (query = '') =>
      (await (
        await me(new Request(`https://trips.example/api/notifications${query}`, { headers: { Cookie: mine } }))
      ).json()) as Listed
    const mark = (path: string, body: unknown) =>
      me(
        new Request(`https://trips.example/api/notifications/${path}`, {
          method: 'POST',
          headers: { Cookie: mine },
          body: JSON.stringify(body),
        }),
      )
    const before = await list()
    expect(before.notifications.map((n) => [n.kind, n.by, n.read])).toEqual(
      expect.arrayContaining([
        ['reply', 'grandma', false],
        ['resolved', 'grandma', false],
      ]),
    )
    expect(before.unread).toBe(2)
    const [first, second] = before.notifications
    await mark('read', { ids: [first!.id] })
    expect((await list()).unread).toBe(1)
    expect((await list('?unread=1')).notifications.map((n) => n.id)).toEqual([second!.id])
    await mark('read', { all: true })
    expect((await list()).unread).toBe(0)
    await mark('unread', { ids: [second!.id] })
    expect((await list()).notifications.find((n) => n.id === second!.id)!.read).toBe(false)
    await mark('read', { threads: [id] })
    expect((await list()).unread).toBe(0)
    expect((await me(new Request('https://trips.example/api/notifications'))).status).toBe(401)
  })
})

describe('browser notifications', () => {
  it('pushes to the other members’ browsers, and forgets browsers that left', async () => {
    const store = memoryStore()
    const sent: [string, PushMessage][] = []
    const push = {
      publicKey: 'key',
      send: async (sub: PushSubscription, message: PushMessage) => {
        sent.push([sub.login, message])
        return sub.endpoint.endsWith('/gone') ? ('gone' as const) : ('ok' as const)
      },
    }
    const grandma = handler('grandma', store, undefined, push)
    const theirs = await signIn(grandma)
    const me = (await (
      await grandma(new Request('https://trips.example/api/me', { headers: { Cookie: theirs } }))
    ).json()) as {
      push: string
    }
    expect(me.push).toBe('key')
    for (const endpoint of ['https://push.example/1', 'https://push.example/gone'])
      expect(
        (
          await grandma(
            new Request('https://trips.example/api/push/subscribe', {
              method: 'POST',
              headers: { Cookie: theirs },
              body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: 'p', auth: 'a' } }, lang: 'en' }),
            }),
          )
        ).status,
      ).toBe(200)

    const alex = handler('Alex', store, undefined, push)
    const mine = await signIn(alex)
    await alex(
      new Request('https://trips.example/api/trips/japan/threads', {
        method: 'POST',
        headers: { Cookie: mine },
        body: JSON.stringify({ anchor: 'day:2026-12-12', body: 'Walk to the station?' }),
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sent).toHaveLength(2)
    expect(sent[0]).toEqual([
      'grandma',
      {
        title: 'Saturday',
        body: 'Alex started a discussion: Walk to the station?',
        url: '/trips/japan/itinerary/?thread=day%3A2026-12-12#2026-12-12',
        tag: expect.stringMatching(/^thread:/),
      },
    ])
    expect((await store.subscriptionsFor(['grandma'])).map((s) => s.endpoint)).toEqual(['https://push.example/1'])
    // Their own language, once they chose one, over the browser's.
    sent.length = 0
    await grandma(
      new Request('https://trips.example/api/me/lang', {
        method: 'POST',
        headers: { Cookie: theirs },
        body: JSON.stringify({ lang: 'ru' }),
      }),
    )
    await alex(
      new Request(`https://trips.example/api/trips/japan/threads`, {
        method: 'POST',
        headers: { Cookie: mine },
        body: JSON.stringify({ anchor: 'trip', body: 'Ещё?' }),
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    // No Russian build in this fixture: the login stands in for the name.
    expect(sent[0]![1].body).toBe('@alex: новое обсуждение: Ещё?')
    expect(await store.userLang('grandma')).toBe('ru')
    sent.length = 0
    const test = await grandma(
      new Request('https://trips.example/api/push/test', { method: 'POST', headers: { Cookie: theirs }, body: '{}' }),
    )
    expect(await test.json()).toMatchObject({ sent: 1, of: 1 })
    expect(sent[0]![1]).toMatchObject({
      title: 'Уведомления включены',
      body: 'Сюда будут приходить ответы, изменения в плане и напоминания о сроках.',
      tag: 'test',
    })
  })
})

describe('change notifications', () => {
  it('lists others’ changes to the plan, unless turned off', async () => {
    const store = memoryStore()
    const me = handler('Alex', store)
    const mine = await signIn(me)
    const list = async () =>
      (
        (await (
          await me(new Request('https://trips.example/api/notifications', { headers: { Cookie: mine } }))
        ).json()) as {
          notifications: { kind: string; by: string; text: string }[]
        }
      ).notifications
    expect(await list()).toEqual([expect.objectContaining({ kind: 'change', by: 'grandma', text: 'Moved: Walk' })])
    const muted = await me(
      new Request('https://trips.example/api/me/notifications', {
        method: 'POST',
        headers: { Cookie: mine },
        body: JSON.stringify({ muted: ['change', 'nonsense'] }),
      }),
    )
    expect(await muted.json()).toEqual({ muted: ['change'] })
    expect(await list()).toEqual([])
  })

  it('pushes changes from a new deploy once, after taking note of the old ones', async () => {
    const store = memoryStore()
    const sent: [string, PushMessage][] = []
    const push = {
      publicKey: 'key',
      send: async (sub: PushSubscription, message: PushMessage) => {
        sent.push([sub.login, message])
        return 'ok' as const
      },
    }
    for (const who of ['Alex', 'grandma']) {
      const handle = handler(who, store, undefined, push)
      const cookies = await signIn(handle)
      await handle(
        new Request('https://trips.example/api/push/subscribe', {
          method: 'POST',
          headers: { Cookie: cookies },
          body: JSON.stringify({
            subscription: { endpoint: `https://push.example/${who}`, keys: { p256dh: 'p', auth: 'a' } },
          }),
        }),
      )
    }
    await handler('nobody', store, undefined, push).announceChanges()
    expect(sent).toEqual([])
    changes([
      { id: 'c2', login: 'grandma', author: 'Grandma', at: Date.now(), summary: 'Added: Onsen' },
      { id: 'c1', login: 'grandma', author: 'Grandma', at: Date.now() - 1000, summary: 'Moved: Walk' },
    ])
    await handler('nobody', store, undefined, push).announceChanges()
    await handler('nobody', store, undefined, push).announceChanges()
    expect(sent).toEqual([
      [
        'alex',
        {
          title: 'Japan',
          body: 'Grandma changed the plan: Added: Onsen',
          url: '/trips/japan/#changes',
          tag: 'change:c2',
        },
      ],
    ])
    changes([{ id: 'c1', login: 'grandma', author: 'Grandma', at: Date.now() - 1000, summary: 'Moved: Walk' }])
  })
})

describe('account language', () => {
  it('serves a signed-in member’s pages in the account’s language, and a change at once', async () => {
    const store = memoryStore()
    const member = handler('Alex', store)
    const cookies = await signIn(member)
    const open = (path: string) =>
      member(new Request(`https://trips.example${path}`, { headers: { ...page, Cookie: `${cookies}; taac_lang=en` } }))
    // No language on the account: the page as asked.
    expect((await open('/trips/japan/')).status).toBe(200)
    await member(
      new Request('https://trips.example/api/me/lang', {
        method: 'POST',
        headers: { Cookie: cookies },
        body: JSON.stringify({ lang: 'ru' }),
      }),
    )
    // Russian on the account wins over this browser's English, right away.
    const redirected = await open('/trips/japan/')
    expect(redirected.status).toBe(302)
    expect(redirected.headers.get('Location')).toBe('/ru/trips/japan/')
    // Already in it: served, not sent on again.
    expect((await open('/ru/trips/japan/')).headers.get('Location')).toBeNull()
  })
})

describe('deadline reminders', () => {
  it('reminds each person at their time where they are, once a rung, one push per trip, and lists it in the bell', async () => {
    writeFileSync(
      join(dist, 'trips/japan/deadlines.json'),
      JSON.stringify({
        timezone: 'Asia/Tokyo',
        deadlines: [
          {
            key: 'booking:item:tower',
            kind: 'booking',
            anchor: 'item:tower',
            date: '2026-11-25',
            logins: ['alex'],
            until: '2026-12-20',
            ladder: 'full',
          },
          {
            key: 'task:vjw',
            kind: 'task',
            anchor: 'task:vjw',
            date: '2026-11-24',
            logins: ['alex'],
            until: '2026-12-10',
            ladder: 'full',
          },
        ],
      }),
    )
    try {
      const store = memoryStore()
      const sent: [string, PushMessage][] = []
      const push = {
        publicKey: 'key',
        send: async (sub: PushSubscription, message: PushMessage) => {
          sent.push([sub.login, message])
          return 'ok' as const
        },
      }
      // Tuesday 24 November, 10:00 in Helsinki.
      let now = Date.parse('2026-11-24T08:00:00Z')
      const member = handler('Alex', store, () => now, push)
      const cookies = await signIn(member)
      const post = (path: string, body: unknown) =>
        member(
          new Request(`https://trips.example${path}`, {
            method: 'POST',
            headers: { Cookie: cookies },
            body: JSON.stringify(body),
          }),
        )
      await post('/api/push/subscribe', {
        subscription: { endpoint: 'https://push.example/s', keys: { p256dh: 'p', auth: 'a' } },
      })

      // Until a browser says where they are, no push: it could come at night.
      await member.remind()
      expect(sent).toEqual([])
      expect((await post('/api/me/reminders', { timeZone: 'Mars/Olympus' })).status).toBe(400)
      expect((await post('/api/me/reminders', { remindAt: '25:00' })).status).toBe(400)
      expect(await (await post('/api/me/reminders', { timeZone: 'Europe/Helsinki' })).json()).toEqual({
        timeZone: 'Europe/Helsinki',
        remindAt: null,
      })

      await member.remind()
      await member.remind()
      // One push per thing, each replacing only its own earlier reminders.
      expect(sent).toEqual([
        [
          'alex',
          {
            title: 'Tokyo Tower',
            body: 'Booking due tomorrow',
            url: '/trips/japan/itinerary/#item-tower',
            tag: 'due:japan:booking:item:tower',
          },
        ],
        [
          'alex',
          {
            title: 'Entry form',
            body: 'Task due today',
            url: '/trips/japan/tasks/#task-vjw',
            tag: 'due:japan:task:vjw',
          },
        ],
      ])

      const bell = async () =>
        (await (
          await member(new Request('https://trips.example/api/notifications', { headers: { Cookie: cookies } }))
        ).json()) as {
          notifications: { id: string; kind: string; due?: string; rung?: number; read: boolean }[]
        }
      expect((await bell()).notifications.filter((n) => n.due)).toMatchObject([
        { id: 'due:booking:item:tower:2026-11-25:1', kind: 'booking', due: '2026-11-25', rung: 1, read: false },
        { id: 'due:task:vjw:2026-11-24:0', kind: 'task', due: '2026-11-24', rung: 0, read: false },
      ])

      // Next morning: only the booking is new, as itself; the task is a day overdue.
      now = Date.parse('2026-11-25T07:30:00Z')
      await post('/api/me/notifications', { muted: ['task'] })
      sent.length = 0
      await member.remind()
      expect(sent).toEqual([
        [
          'alex',
          {
            title: 'Tokyo Tower',
            body: 'Booking due today',
            url: '/trips/japan/itinerary/#item-tower',
            tag: 'due:japan:booking:item:tower',
          },
        ],
      ])
      expect((await bell()).notifications.filter((n) => n.due).map((n) => n.id)).toEqual([
        'due:booking:item:tower:2026-11-25:0',
      ])
    } finally {
      rmSync(join(dist, 'trips/japan/deadlines.json'))
    }
  })
})

describe('place photos', () => {
  it('serves a trip’s photos resized, to those who see the trip, fetching each once', async () => {
    const store = memoryStore()
    const member = handler('Alex', store)
    const cookies = await signIn(member)
    const get = (size: string) =>
      member(new Request(`https://trips.example/api/photos/0123456789abcdef/${size}`, { headers: { Cookie: cookies } }))
    const before = photoFetches
    const thumb = await get('thumb')
    expect(thumb.status).toBe(200)
    expect(thumb.headers.get('Content-Type')).toBe('image/webp')
    expect(await sharp(new Uint8Array(await thumb.arrayBuffer())).metadata()).toMatchObject({ width: 168, height: 168 })
    // Never enlarged: the original is 300 wide.
    const large = await get('large')
    expect(await sharp(new Uint8Array(await large.arrayBuffer())).metadata()).toMatchObject({ width: 300, height: 200 })
    expect(photoFetches - before).toBe(1)

    expect((await member(new Request('https://trips.example/api/photos/0123456789abcdef/thumb'))).status).toBe(404)
    const stranger = handler('stranger', store)
    const theirs = await signIn(stranger)
    expect(
      (
        await stranger(
          new Request('https://trips.example/api/photos/0123456789abcdef/thumb', { headers: { Cookie: theirs } }),
        )
      ).status,
    ).toBe(404)
    expect((await get('../thumb')).status).not.toBe(200)
  })
})
