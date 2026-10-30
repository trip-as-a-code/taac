/**
 * The access manifest the web build emits at /_taac/access.json, and the
 * routing rules derived from it: which paths are public, which need the
 * site password, which a trip's.
 */

/** One string for every language, or one per language. */
export type Text = string | Record<string, string>

export interface AccessManifest {
  title: Text
  site: { secret: string } | null
  trips: Record<string, { secret: string; title: string }>
  /** Every trip on the site. */
  slugs: string[]
  locales: string[]
  defaultLocale: string
}

export type Scope = 'site' | `trip:${string}`

export const EMPTY_MANIFEST: AccessManifest = {
  title: 'taac',
  site: null,
  trips: {},
  slugs: [],
  locales: ['en'],
  defaultLocale: 'en',
}

export const MANIFEST_PATH = '/_taac/access.json'

let cached: Promise<AccessManifest> | undefined

/** Loads the manifest once per isolate; a missing one means no protection. */
export function loadManifest(assets: Fetcher, requestUrl: string): Promise<AccessManifest> {
  cached ??= assets
    .fetch(new Request(new URL(MANIFEST_PATH, requestUrl)))
    .then(async (response) => (response.ok ? normalise(await response.json()) : EMPTY_MANIFEST))
    .catch(() => EMPTY_MANIFEST)
  return cached
}

export function resetManifestCache(): void {
  cached = undefined
}

export function normalise(raw: unknown): AccessManifest {
  const value = (raw ?? {}) as Partial<AccessManifest>
  const locales = Array.isArray(value.locales) && value.locales.length ? value.locales : EMPTY_MANIFEST.locales
  return {
    title: isText(value.title) ? value.title : EMPTY_MANIFEST.title,
    site: value.site && typeof value.site.secret === 'string' ? { secret: value.site.secret } : null,
    trips: value.trips && typeof value.trips === 'object' ? value.trips : {},
    slugs: Array.isArray(value.slugs) ? value.slugs.filter((s): s is string => typeof s === 'string') : [],
    locales,
    defaultLocale: typeof value.defaultLocale === 'string' ? value.defaultLocale : (locales[0] ?? 'en'),
  }
}

function isText(value: unknown): value is Text {
  return (
    typeof value === 'string' ||
    (typeof value === 'object' && value !== null && Object.values(value).every((v) => typeof v === 'string'))
  )
}

/** Exact language, then English, then whatever there is. */
export function localizedText(text: Text, lang: string): string {
  if (typeof text === 'string') return text
  return text[lang] ?? text.en ?? Object.values(text)[0] ?? ''
}

export function isProtected(manifest: AccessManifest): boolean {
  return manifest.site !== null || Object.keys(manifest.trips).length > 0
}

export function extraLocales(manifest: AccessManifest): string[] {
  return manifest.locales.filter((locale) => locale !== manifest.defaultLocale)
}

/** Splits a non-default locale prefix (`/ru/...`) off a path. */
export function splitLocale(path: string, manifest: AccessManifest): { locale: string | null; rest: string } {
  for (const locale of extraLocales(manifest)) {
    if (path === `/${locale}`) return { locale, rest: '/' }
    if (path.startsWith(`/${locale}/`)) return { locale, rest: path.slice(locale.length + 1) }
  }
  return { locale: null, rest: path }
}

const PUBLIC_EXACT = new Set([
  '/login',
  '/api/login',
  '/api/logout',
  '/favicon.svg',
  '/robots.txt',
  '/manifest.webmanifest',
])

export function isPublicPath(path: string, manifest: AccessManifest): boolean {
  if (PUBLIC_EXACT.has(path) || path.startsWith('/icons/')) return true
  const { locale, rest } = splitLocale(path, manifest)
  return locale !== null && rest === '/login'
}

/** The trip slug a path belongs to (`/trips/<slug>/…`, locale-prefixed or not). */
export function tripOf(path: string, manifest: AccessManifest): string | null {
  const { rest } = splitLocale(path, manifest)
  const match = /^\/trips\/([^/]+)(?:\/|$)/.exec(rest)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

/** Scopes a request to `path` must hold, outermost first. */
export function requiredScopes(path: string, manifest: AccessManifest): Scope[] {
  const scopes: Scope[] = []
  if (manifest.site && !isPublicPath(path, manifest)) scopes.push('site')
  const slug = tripOf(path, manifest)
  if (slug && manifest.trips[slug]) scopes.push(`trip:${slug}`)
  return scopes
}

export function parseScope(raw: string | null, manifest: AccessManifest): Scope | null {
  if (raw === 'site') return manifest.site ? 'site' : null
  if (raw?.startsWith('trip:')) {
    const slug = raw.slice(5)
    return manifest.trips[slug] ? `trip:${slug}` : null
  }
  return null
}

export function secretNameFor(scope: Scope, manifest: AccessManifest): string | undefined {
  if (scope === 'site') return manifest.site?.secret
  return manifest.trips[scope.slice(5)]?.secret
}

export function cookieName(scope: Scope): string {
  return scope === 'site' ? 'taac_site' : `taac_trip_${scope.slice(5)}`
}

/** Same-origin absolute paths only; anything else falls back. */
export function sanitizeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback
  // Control characters (header splitting, tab/newline tricks).
  if ([...next].some((char) => char.charCodeAt(0) < 0x20)) return fallback
  return next
}

export function loginPath(locale: string | null, manifest: AccessManifest): string {
  return locale && locale !== manifest.defaultLocale ? `/${locale}/login` : '/login'
}

export function localeRoot(locale: string | null, manifest: AccessManifest): string {
  return locale && locale !== manifest.defaultLocale ? `/${locale}/` : '/'
}

/** `/trips/<slug>/calendar.ics` and per-person `calendar-<member>.ics`: the paths a calendar key unlocks. */
export function calendarSlug(path: string): string | null {
  const match = /^\/trips\/([^/]+)\/calendar(?:-[^/]+)?\.ics$/.exec(path)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
