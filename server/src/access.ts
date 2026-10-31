/**
 * The access manifest the web build emits at /_taac/access.json, and the
 * rules derived from it: which paths are open to everyone, which need a
 * signed-in GitHub account, and which trip that account must be on.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One string for every language, or one per language. */
export type Text = string | Record<string, string>

export interface TripAccess {
  title: string
  /** Open to everyone, signed in or not. */
  public: boolean
  /** Lowercase GitHub usernames who may see it: its members' and its viewers. */
  logins: string[]
}

export interface AccessManifest {
  title: Text
  /** `github`: signing in is required for everything not public. */
  auth: 'github' | null
  trips: Record<string, TripAccess>
  /** Every trip on the site. */
  slugs: string[]
  locales: string[]
  defaultLocale: string
}

export const EMPTY_MANIFEST: AccessManifest = {
  title: 'taac',
  auth: null,
  trips: {},
  slugs: [],
  locales: ['en'],
  defaultLocale: 'en',
}

export const MANIFEST_PATH = '_taac/access.json'

/** Reads the manifest from the built site; a missing one means everything is open. */
export async function loadManifest(dist: string): Promise<AccessManifest> {
  try {
    return normalise(JSON.parse(await readFile(join(dist, MANIFEST_PATH), 'utf8')))
  } catch {
    return EMPTY_MANIFEST
  }
}

export function normalise(raw: unknown): AccessManifest {
  const value = (raw ?? {}) as Partial<AccessManifest>
  const locales = Array.isArray(value.locales) && value.locales.length ? value.locales : EMPTY_MANIFEST.locales
  const trips: Record<string, TripAccess> = {}
  for (const [slug, trip] of Object.entries(value.trips && typeof value.trips === 'object' ? value.trips : {})) {
    trips[slug] = {
      title: typeof trip?.title === 'string' ? trip.title : slug,
      public: trip?.public === true,
      logins: Array.isArray(trip?.logins)
        ? trip.logins.filter((l): l is string => typeof l === 'string').map((l) => l.toLowerCase())
        : [],
    }
  }
  return {
    title: isText(value.title) ? value.title : EMPTY_MANIFEST.title,
    auth: value.auth === 'github' ? 'github' : null,
    trips,
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
  return manifest.auth !== null
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
  '/api/auth/github',
  '/api/auth/callback',
  '/api/logout',
  '/api/me',
  '/healthz',
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

/** Every GitHub username on any trip of the site: who may sign in at all. */
export function siteLogins(manifest: AccessManifest): Set<string> {
  return new Set(Object.values(manifest.trips).flatMap((t) => t.logins))
}

export type Decision = 'open' | 'sign-in' | 'forbidden'

/**
 * What a request to `path` needs from `login` (lowercase, or null when not
 * signed in): nothing, to sign in first, or it isn't theirs to see.
 */
export function decide(path: string, login: string | null, manifest: AccessManifest): Decision {
  if (manifest.auth === null || isPublicPath(path, manifest)) return 'open'
  const slug = tripOf(path, manifest)
  const trip = slug ? manifest.trips[slug] : undefined
  if (trip?.public) return 'open'
  if (!login) return 'sign-in'
  if (trip) return trip.logins.includes(login) ? 'open' : 'forbidden'
  return siteLogins(manifest).has(login) ? 'open' : 'forbidden'
}

/** The trips `login` may see, for the page to show only those. */
export function visibleTrips(login: string | null, manifest: AccessManifest): string[] {
  return manifest.slugs.filter((slug) => decide(`/trips/${slug}/`, login, manifest) === 'open')
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
