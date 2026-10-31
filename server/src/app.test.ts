import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { normalise } from './access'
import { createHandler } from './app'
import { calendarKey } from './auth'
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
beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'taac-dist-'))
  mkdirSync(join(dist, 'trips/japan'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<h1>home</h1>')
  writeFileSync(join(dist, 'trips/japan/index.html'), '<h1>japan</h1>')
  writeFileSync(join(dist, 'trips/japan/calendar.ics'), 'BEGIN:VCALENDAR')
  writeFileSync(join(dist, '404.html'), '<h1>nope</h1>')
})

/** GitHub, answering every code with `who`. */
function github(who: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/access_token')) return Response.json({ access_token: 'token' })
    if (url.endsWith('/user')) return Response.json({ login: who })
    if (url.startsWith('https://github.com/alex.png'))
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'Content-Type': 'image/jpeg' } })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
}

function memoryStore(): Store {
  const trips = new Map<string, Ticks>()
  return {
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

function handler(who = 'Alex') {
  return createHandler(
    {
      dist,
      publicUrl: 'https://trips.example',
      sessionSecret: 'secret',
      github: { clientId: 'id', clientSecret: 'shh' },
      store: memoryStore(),
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
    expect(await login.text()).toContain('/api/auth/github?next=%2Ftrips%2Fjapan%2F')

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
