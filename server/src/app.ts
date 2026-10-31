/**
 * The taac server in front of the built site. It owns signing in with
 * GitHub, who may see what (from /_taac/access.json, emitted by the web build
 * from site.yaml), calendar feeds that work without cookies, the remembered
 * UI language, `/api/fx`, packing ticks, the people's GitHub pictures, and
 * the security headers.
 */

import {
  calendarSlug,
  decide,
  isProtected,
  localeRoot,
  localizedText,
  loginPath,
  mayTick,
  roleOf,
  sanitizeNext,
  splitLocale,
  tripOf,
  visibleTrips,
  type AccessManifest,
} from './access'
import {
  calendarKey,
  clearedCookie,
  LINK_COOKIE,
  linkCookie,
  randomState,
  readCookie,
  sameState,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionCookies,
  signSession,
  SIGNED_IN_COOKIE,
  STATE_COOKIE,
  stateCookie,
  verifySession,
} from './auth'
import { avatarLogin, avatarSource, mayShowAvatar } from './avatars'
import {
  describe,
  linkCookieAge,
  linksRoute,
  linkToken,
  MAX_LINKS,
  newLink,
  signLinkCookie,
  verifyLinkCookie,
  works,
  type ShareLink,
} from './links'
import { handleFx } from './fx'
import { authorizeUrl, userFor, type GithubApp } from './github'
import { robotsTxt, secureResponse } from './headers'
import { languageRedirect, pageLanguage } from './i18n'
import { renderForbiddenPage, renderLinkGonePage, renderLoginPage, type Theme } from './login-page'
import { packingSlug } from './packing'
import { serveStatic } from './static'
import type { Store } from './store'

export interface Config {
  /** The built site (`web/dist`). */
  dist: string
  /** Where the site answers, such as `https://trips.example.com`; else taken from each request. */
  publicUrl?: string
  sessionSecret?: string
  github?: GithubApp
  /** Shared state; without it the packing list is read-only. */
  store?: Store
  noindex?: boolean
  fetcher?: typeof fetch
  now?: () => number
}

const nowSec = (config: Config): number => Math.floor((config.now?.() ?? Date.now()) / 1000)

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function redirect(location: string, status: 302 | 303, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status, headers })
}

/** The theme the viewer picked on the site; dark until they choose. */
function themeOf(request: Request): Theme {
  return readCookie(request.headers.get('Cookie'), 'taac_theme') === 'light' ? 'light' : 'dark'
}

export function createHandler(config: Config, manifest: AccessManifest): (request: Request) => Promise<Response> {
  const origin = (request: Request) => config.publicUrl?.replace(/\/$/, '') ?? new URL(request.url).origin
  const secure = (request: Request) => origin(request).startsWith('https:')
  const ready = !isProtected(manifest) || (!!config.sessionSecret && !!config.github)
  const avatarOf = avatarSource(config.store, config.fetcher ?? fetch)

  async function loginOf(request: Request): Promise<string | null> {
    if (!config.sessionSecret) return null
    const session = await verifySession(
      readCookie(request.headers.get('Cookie'), SESSION_COOKIE),
      config.sessionSecret,
      nowSec(config),
    )
    return session?.login ?? null
  }

  const language = (request: Request, path: string) =>
    pageLanguage(path, request.headers.get('Cookie'), request.headers.get('Accept-Language'), manifest)

  function startSignIn(request: Request, url: URL): Response {
    if (!config.github || !config.sessionSecret) return text('taac: signing in is not configured\n', 500)
    const next = sanitizeNext(url.searchParams.get('next'), '/')
    const state = randomState()
    const target = authorizeUrl(config.github, `${origin(request)}/api/auth/callback`, state)
    return redirect(target, 302, [stateCookie(`${state}|${encodeURIComponent(next)}`, secure(request))])
  }

  async function finishSignIn(request: Request, url: URL): Promise<Response> {
    if (!config.github || !config.sessionSecret) return text('taac: signing in is not configured\n', 500)
    const [state, rawNext] = (readCookie(request.headers.get('Cookie'), STATE_COOKIE) ?? '').split('|')
    const next = sanitizeNext(rawNext ? decodeURIComponent(rawNext) : null, '/')
    const failed = () => {
      const lang = language(request, next)
      const params = new URLSearchParams({ next, error: '1' })
      return redirect(`${loginPath(lang, manifest)}?${params}`, 303, [clearedCookie(STATE_COOKIE, secure(request))])
    }
    const code = url.searchParams.get('code')
    if (!code || !sameState(state ?? null, url.searchParams.get('state'))) return failed()
    const user = await userFor(config.github, code, `${origin(request)}/api/auth/callback`, config.fetcher).catch(
      () => null,
    )
    if (!user) return failed()
    const value = await signSession(config.sessionSecret, { login: user.login, exp: nowSec(config) + SESSION_MAX_AGE })
    return redirect(next, 303, [
      ...sessionCookies(value, secure(request)),
      clearedCookie(STATE_COOKIE, secure(request)),
    ])
  }

  function signOut(request: Request): Response {
    return redirect('/', 303, [
      clearedCookie(SESSION_COOKIE, secure(request)),
      clearedCookie(SIGNED_IN_COOKIE, secure(request)),
    ])
  }

  /** Links checked in the last half minute, so a page's many requests ask the database once. */
  const checked = new Map<string, { link: ShareLink | null; until: number }>()

  /** The view-only link this browser opened, while it still works. */
  async function linkOf(request: Request): Promise<ShareLink | null> {
    if (!config.store || !config.sessionSecret) return null
    const cookie = await verifyLinkCookie(readCookie(request.headers.get('Cookie'), LINK_COOKIE), config.sessionSecret)
    if (!cookie || !manifest.slugs.includes(cookie.trip)) return null
    const now = config.now?.() ?? Date.now()
    let hit = checked.get(cookie.id)
    if (!hit || hit.until < now) {
      hit = { link: await config.store.linkById(cookie.id), until: now + 30_000 }
      checked.set(cookie.id, hit)
    }
    return works(hit.link, now) && hit.link.trip === cookie.trip ? hit.link : null
  }

  /** The trips a request may see: its account's, and its link's. */
  function tripsFor(login: string | null, link: ShareLink | null): string[] {
    const trips = visibleTrips(login, manifest)
    return link && !trips.includes(link.trip) ? [...trips, link.trip] : trips
  }

  /** Who may make and revoke a trip's links: its `member`s, when there is somewhere to keep them. */
  const mayShare = (slug: string, login: string | null) => !!config.store && roleOf(slug, login, manifest) === 'member'

  /** Who is signed in, which trips they see, tick and share, their calendar keys, and the link they came by. */
  async function me(request: Request): Promise<Response> {
    const login = await loginOf(request)
    const link = await linkOf(request)
    const trips = tripsFor(login, link)
    const calendars: Record<string, string> = {}
    // A link holder gets no calendar key: keys don't expire, links do.
    if (config.sessionSecret && (login || !isProtected(manifest)))
      for (const slug of visibleTrips(login, manifest)) calendars[slug] = await calendarKey(config.sessionSecret, slug)
    const packing = manifest.slugs.filter((slug) => mayTick(slug, login, manifest))
    const share = manifest.slugs.filter((slug) => mayShare(slug, login))
    return json({
      login,
      trips,
      packing,
      share,
      calendars,
      link: link ? { trip: link.trip, label: link.label, expiresAt: link.expiresAt } : null,
    })
  }

  /** `/s/<token>`: remembers the link in this browser and opens its trip. */
  async function openLink(request: Request, token: string): Promise<Response> {
    const now = config.now?.() ?? Date.now()
    const link = config.store ? await config.store.linkByToken(token) : null
    const lang = language(request, '/')
    if (!works(link, now) || !config.sessionSecret || !manifest.slugs.includes(link.trip))
      return html(
        renderLinkGonePage({
          lang,
          title: localizedText(manifest.title, lang),
          signIn: loginPath(lang === manifest.defaultLocale ? null : lang, manifest),
          theme: themeOf(request),
        }),
        410,
      )
    await config.store!.touchLink(link.id, now).catch(() => undefined)
    const cookie = await signLinkCookie(config.sessionSecret, link)
    const home = localeRoot(lang === manifest.defaultLocale ? null : lang, manifest)
    return redirect(`${home}trips/${encodeURIComponent(link.trip)}/`, 303, [
      linkCookie(cookie, secure(request), linkCookieAge(link, now)),
    ])
  }

  /** `/api/trips/<slug>/links`: the trip's working links (GET), a new one (POST), revoking one (DELETE). */
  async function links(request: Request, slug: string, id: string | null): Promise<Response> {
    const login = await loginOf(request)
    if (!manifest.slugs.includes(slug) || !config.store) return text('Not found\n', 404)
    if (!login) return text('Unauthorized\n', 401)
    if (!mayShare(slug, login)) return text('Only the trip’s members share it\n', 403)
    const now = config.now?.() ?? Date.now()
    const list = async () =>
      json({ links: (await config.store!.links(slug, now)).map((l) => describe(l, origin(request))) })
    if (request.method === 'GET' && !id) return list()
    if (request.method === 'POST' && !id) {
      const body = (await request.json().catch(() => ({}))) as { label?: unknown; expires?: unknown }
      const link = newLink(slug, body.label, body.expires, login, now)
      if (!link) return text('expected {label, expires: 1d|1w|1m|never}\n', 400)
      if ((await config.store.links(slug, now)).length >= MAX_LINKS) return text('Too many links\n', 409)
      await config.store.createLink(link)
      return list()
    }
    if (request.method === 'DELETE' && id) {
      if (!(await config.store.revokeLink(slug, id, login, now))) return text('Not found\n', 404)
      checked.delete(id)
      return list()
    }
    return text('Method not allowed\n', 405)
  }

  /** Unlocks the calendar feed for subscribers, who cannot sign in. */
  async function calendarKeyValid(path: string, url: URL): Promise<boolean> {
    const slug = calendarSlug(path)
    const key = url.searchParams.get('key')
    if (!slug || !key || !config.sessionSecret) return false
    return key === (await calendarKey(config.sessionSecret, slug))
  }

  /** A trip person's GitHub picture, or 404 so the site keeps their initials. */
  async function avatar(request: Request, login: string): Promise<Response> {
    const none = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } })
    if (!mayShowAvatar(login, tripsFor(await loginOf(request), await linkOf(request)), manifest)) return none()
    const found = await avatarOf(login, config.now?.() ?? Date.now())
    if (!found?.image || !found.type) return none()
    return new Response(found.image, {
      headers: { 'Content-Type': found.type, 'Cache-Control': 'private, max-age=86400' },
    })
  }

  async function packing(request: Request, slug: string): Promise<Response> {
    if (!config.store || !manifest.slugs.includes(slug)) return text('Not found\n', 404)
    if (request.method === 'POST') {
      const login = await loginOf(request)
      if (!mayTick(slug, login, manifest)) return text('Only the trip’s people tick\n', 403)
      const body = (await request.json().catch(() => ({}))) as { changes?: unknown }
      await config.store.apply(slug, body.changes, config.now?.() ?? Date.now(), login)
    } else if (request.method !== 'GET') return text('Method not allowed\n', 405)
    return json({ ticks: await config.store.ticks(slug) })
  }

  async function route(request: Request): Promise<{ response: Response; underProtection: boolean }> {
    const url = new URL(request.url)
    const path = url.pathname
    const plain = (response: Response) => ({ response, underProtection: false })
    const noindex = isProtected(manifest) || config.noindex === true

    if (path === '/healthz') return plain(text('ok\n', 200))
    if (path.startsWith('/_taac/')) return plain(text('Not found\n', 404))
    if (path === '/robots.txt') return plain(text(robotsTxt(noindex), 200))

    // Before the language redirect: a link is one address, in any language.
    const token = linkToken(path)
    if (token) return plain(await openLink(request, token))

    const languageTarget = languageRedirect(
      {
        method: request.method,
        path,
        search: url.search,
        accept: request.headers.get('Accept'),
        cookie: request.headers.get('Cookie'),
        acceptLanguage: request.headers.get('Accept-Language'),
      },
      manifest,
    )
    if (languageTarget) return plain(redirect(languageTarget, 302))

    if (path === '/api/auth/github') return plain(startSignIn(request, url))
    if (path === '/api/auth/callback') return plain(await finishSignIn(request, url))
    if (path === '/api/logout')
      return plain(request.method === 'POST' ? signOut(request) : text('Method not allowed\n', 405))
    if (path === '/api/me') return plain(await me(request))
    const linkApi = linksRoute(path)
    if (linkApi) return plain(await links(request, linkApi.slug, linkApi.id))
    const pictured = avatarLogin(path)
    if (pictured) return plain(await avatar(request, pictured))

    const { locale, rest } = splitLocale(path, manifest)
    if (rest === '/login') {
      const lang = language(request, path)
      const next = sanitizeNext(url.searchParams.get('next'), localeRoot(lang, manifest))
      if (!isProtected(manifest) || (await loginOf(request))) return plain(redirect(next, 302))
      return plain(
        html(
          renderLoginPage({
            lang,
            title: localizedText(manifest.title, lang),
            next,
            error: url.searchParams.get('error') === '1',
            theme: themeOf(request),
          }),
        ),
      )
    }

    const login = await loginOf(request)
    let decision = decide(path, login, manifest)
    if (decision !== 'open' && (await calendarKeyValid(path, url))) decision = 'open'
    if (decision !== 'open') {
      // A link opens its own trip and what its pages load, never another trip
      // or the list of them: the home page sends it to its trip.
      const link = await linkOf(request)
      const slug = tripOf(path, manifest)
      if (link && slug === link.trip) decision = 'open'
      else if (link && slug === null) {
        if (rest === '/')
          return plain(redirect(`${localeRoot(locale, manifest)}trips/${encodeURIComponent(link.trip)}/`, 302))
        decision = 'open'
      }
    }
    if (decision !== 'open' && !ready)
      return plain(text('taac: signing in is configured but its secrets are missing\n', 500))
    if (decision === 'sign-in') {
      if (request.headers.get('Accept')?.includes('text/html')) {
        const params = new URLSearchParams({ next: path + url.search })
        return plain(redirect(`${loginPath(locale, manifest)}?${params}`, 302))
      }
      return plain(text('Unauthorized\n', 401))
    }
    if (decision === 'forbidden') {
      if (request.headers.get('Accept')?.includes('text/html')) {
        const lang = language(request, path)
        const slug = tripOf(path, manifest)
        return plain(
          html(
            renderForbiddenPage({
              lang,
              title: slug ? (manifest.trips[slug]?.title ?? slug) : localizedText(manifest.title, lang),
              login: login ?? '',
              trip: slug !== null,
              home: localeRoot(locale, manifest),
              theme: themeOf(request),
            }),
            403,
          ),
        )
      }
      return plain(text('Forbidden\n', 403))
    }

    const underProtection = isProtected(manifest) && !manifest.trips[tripOf(path, manifest) ?? '']?.public
    if (path === '/api/fx') return { response: await handleFx(url, config.fetcher), underProtection }
    const slug = packingSlug(path)
    if (slug) return { response: await packing(request, slug), underProtection }
    return { response: await serveStatic(config.dist, request), underProtection }
  }

  return async (request) => {
    const url = new URL(request.url)
    const { response, underProtection } = await route(request)
    return secureResponse(response, {
      https: secure(request),
      noindex: isProtected(manifest) || config.noindex === true,
      path: url.pathname,
      siteProtected: isProtected(manifest),
      underProtection,
    })
  }
}
