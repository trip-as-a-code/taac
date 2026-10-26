/**
 * Edge worker in front of the static taac site. It runs before every asset
 * request and owns: optional passwords (whole site and/or single trips),
 * calendar feeds that work without cookies, the remembered UI language,
 * `/api/fx`, and the security headers. What is protected comes from
 * /_taac/access.json, emitted by the web build from site.yaml.
 */

import {
  calendarSlug,
  cookieName,
  isProtected,
  localeRoot,
  loadManifest,
  loginPath,
  parseScope,
  requiredScopes,
  sanitizeNext,
  secretNameFor,
  splitLocale,
  type AccessManifest,
  type Scope,
  localizedText,
} from './access'
import {
  calendarKey,
  clearedCookie,
  cookieNames,
  passwordMatches,
  readCookie,
  SESSION_MAX_AGE,
  sessionCookie,
  signSession,
  verifySession,
} from './auth'
import { handleFx } from './fx'
import { packingSlug } from './packing'
import { robotsTxt, secureResponse } from './headers'
import { languageRedirect, pageLanguage } from './i18n'
import { renderLoginPage, renderTooManyAttempts, type Theme } from './login-page'

export { PackingState } from './packing-state'

export interface Env {
  ASSETS: Fetcher
  /** Optional: shared packing ticks; without it ticks stay on each device. */
  PACKING?: DurableObjectNamespace
  SESSION_SECRET?: string
  LOGIN_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> }
  NOINDEX?: string
  [secret: string]: unknown
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function html(body: string, status = 200, extra: HeadersInit = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...extra } })
}

function text(body: string, status: number, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

function redirect(location: string, status: 302 | 303, extra: [string, string][] = []): Response {
  const headers = new Headers({ Location: location })
  for (const [k, v] of extra) headers.append(k, v)
  return new Response(null, { status, headers })
}

/** The password for a scope, or null when the deployment lacks its secrets (fail closed). */
function passwordFor(scope: Scope, manifest: AccessManifest, env: Env): string | null {
  const name = secretNameFor(scope, manifest)
  const value = name ? env[name] : undefined
  return typeof value === 'string' && value !== '' && env.SESSION_SECRET ? value : null
}

function misconfigured(manifest: AccessManifest, env: Env): Response {
  const names = [manifest.site?.secret, ...Object.values(manifest.trips).map((t) => t.secret)].filter(
    (n): n is string => !!n && typeof env[n] !== 'string',
  )
  if (!env.SESSION_SECRET) names.unshift('SESSION_SECRET')
  return text(`taac: access is configured but secrets are missing${names.length ? `: ${names.join(', ')}` : ''}\n`, 500)
}

async function handleLogin(request: Request, url: URL, manifest: AccessManifest, env: Env): Promise<Response> {
  const form = await request.formData()
  const scope = parseScope(String(form.get('scope') ?? ''), manifest)
  const lang = pageLanguage(
    url.pathname,
    request.headers.get('Cookie'),
    request.headers.get('Accept-Language'),
    manifest,
  )
  const fallback = localeRoot(lang, manifest)
  const next = sanitizeNext(String(form.get('next') ?? ''), fallback)
  if (!scope) return redirect(next, 303)

  const password = passwordFor(scope, manifest, env)
  if (password === null) return misconfigured(manifest, env)

  if (env.LOGIN_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    const { success } = await env.LOGIN_LIMITER.limit({ key: `${ip}:${scope}` })
    if (!success) {
      const back = `${loginPath(lang, manifest)}?scope=${encodeURIComponent(scope)}&next=${encodeURIComponent(next)}`
      return html(renderTooManyAttempts(lang, back, themeOf(request)), 429, { 'Retry-After': '60' })
    }
  }

  if (!(await passwordMatches(String(form.get('password') ?? ''), password))) {
    const params = new URLSearchParams({ scope, next, error: '1' })
    return redirect(`${loginPath(lang, manifest)}?${params}`, 303)
  }
  const value = await signSession(env.SESSION_SECRET!, password, scope, nowSec() + SESSION_MAX_AGE)
  return redirect(next, 303, [['Set-Cookie', sessionCookie(scope, value)]])
}

function handleLogout(request: Request, manifest: AccessManifest): Response {
  const names = new Set(['taac_site', ...Object.keys(manifest.trips).map((slug) => cookieName(`trip:${slug}`))])
  for (const name of cookieNames(request.headers.get('Cookie'))) {
    if (name.startsWith('taac_') && name !== 'taac_lang' && name !== 'taac_theme') names.add(name)
  }
  return redirect(
    '/',
    303,
    [...names].map((name): [string, string] => ['Set-Cookie', clearedCookie(name)]),
  )
}

function loginPage(request: Request, url: URL, manifest: AccessManifest): Response {
  const lang = pageLanguage(
    url.pathname,
    request.headers.get('Cookie'),
    request.headers.get('Accept-Language'),
    manifest,
  )
  const scope = parseScope(url.searchParams.get('scope'), manifest) ?? (manifest.site ? 'site' : null)
  const next = sanitizeNext(url.searchParams.get('next'), localeRoot(lang, manifest))
  if (!scope) return redirect(next, 302)
  const trip = scope === 'site' ? null : manifest.trips[scope.slice(5)]
  return html(
    renderLoginPage({
      lang,
      title: trip?.title ?? localizedText(manifest.title, lang),
      scope,
      next,
      error: url.searchParams.get('error') === '1',
      trip: trip !== null,
      theme: themeOf(request),
    }),
  )
}

/** The theme the viewer picked on the site; dark until they choose. */
function themeOf(request: Request): Theme {
  return readCookie(request.headers.get('Cookie'), 'taac_theme') === 'light' ? 'light' : 'dark'
}

/** Unlocks the calendar feed for subscribers, who cannot log in. */
async function calendarKeyValid(path: string, url: URL, env: Env): Promise<boolean> {
  const slug = calendarSlug(path)
  const key = url.searchParams.get('key')
  if (!slug || !key || !env.SESSION_SECRET) return false
  return key === (await calendarKey(env.SESSION_SECRET, slug))
}

/** Marks protected pages and hands authorised viewers keyed calendar URLs. */
function rewriteHtml(response: Response, url: URL, manifest: AccessManifest, env: Env): Response {
  const secret = env.SESSION_SECRET
  return new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('data-auth', '1')
      },
    })
    .on('a[data-calendar-feed]', {
      async element(el) {
        const slug = el.getAttribute('data-calendar-feed')
        if (!slug || !secret || !(manifest.site || manifest.trips[slug])) return
        const key = await calendarKey(secret, slug)
        const file = el.getAttribute('data-calendar-file') ?? 'calendar.ics'
        const feed = `${url.protocol}//${url.host}/trips/${encodeURIComponent(slug)}/${file}?key=${key}`
        el.setAttribute('href', feed)
        // Lets the page switch to a per-person feed without a round trip.
        el.setAttribute('data-calendar-key', key)
        el.setAttribute('data-webcal', feed.replace(/^https?:/, 'webcal:'))
      },
    })
    .transform(response)
}

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  manifest: AccessManifest,
): Promise<{
  response: Response
  underProtection: boolean
}> {
  const url = new URL(request.url)
  const path = url.pathname
  const noindex = isProtected(manifest) || env.NOINDEX === 'true'
  const plain = (response: Response) => ({ response, underProtection: false })

  if (path.startsWith('/_taac/')) return plain(text('Not found\n', 404))
  if (path === '/robots.txt') return plain(text(robotsTxt(noindex), 200))

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

  if (path === '/api/login') {
    return plain(
      request.method === 'POST' ? await handleLogin(request, url, manifest, env) : text('Method not allowed\n', 405),
    )
  }
  if (path === '/api/logout') {
    return plain(request.method === 'POST' ? handleLogout(request, manifest) : text('Method not allowed\n', 405))
  }
  const { locale, rest } = splitLocale(path, manifest)
  if (rest === '/login') return plain(loginPage(request, url, manifest))

  const scopes = requiredScopes(path, manifest)
  const keyed = scopes.length > 0 && (await calendarKeyValid(path, url, env))
  if (!keyed) {
    const cookie = request.headers.get('Cookie')
    for (const scope of scopes) {
      const password = passwordFor(scope, manifest, env)
      if (password === null) return plain(misconfigured(manifest, env))
      if (await verifySession(readCookie(cookie, cookieName(scope)), env.SESSION_SECRET!, password, scope, nowSec())) {
        continue
      }
      if (request.headers.get('Accept')?.includes('text/html')) {
        const params = new URLSearchParams({ scope, next: path + url.search })
        return plain(redirect(`${loginPath(locale, manifest)}?${params}`, 302))
      }
      return plain(text('Unauthorized\n', 401))
    }
  }

  const underProtection = scopes.length > 0
  if (path === '/api/fx') return { response: await handleFx(url, ctx), underProtection }
  // Behind the trip's password like its pages: only travellers read or tick.
  const packing = packingSlug(path)
  if (packing) {
    if (!env.PACKING || !manifest.slugs.includes(packing))
      return { response: text('Not found\n', 404), underProtection }
    if (request.method !== 'GET' && request.method !== 'POST')
      return { response: text('Method not allowed\n', 405), underProtection }
    const stub = env.PACKING.get(env.PACKING.idFromName(packing))
    return { response: await stub.fetch(request), underProtection }
  }

  let response = await env.ASSETS.fetch(request)
  if (underProtection && response.headers.get('Content-Type')?.includes('text/html')) {
    response = rewriteHtml(response, url, manifest, env)
  }
  return { response, underProtection }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const manifest = await loadManifest(env.ASSETS, request.url)
    const url = new URL(request.url)
    const { response, underProtection } = await route(request, env, ctx, manifest)
    return secureResponse(response, {
      https: url.protocol === 'https:',
      noindex: isProtected(manifest) || env.NOINDEX === 'true',
      path: url.pathname,
      siteProtected: manifest.site !== null,
      underProtection,
    })
  },
} satisfies ExportedHandler<Env>
