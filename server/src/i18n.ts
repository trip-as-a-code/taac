/** Locale negotiation: the remembered choice (`taac_lang`) wins, then Accept-Language. */

import { splitLocale, type AccessManifest } from './access'
import { readCookie } from './auth'

export const LANG_COOKIE = 'taac_lang'

export interface RedirectInput {
  method: string
  path: string
  search: string
  accept: string | null
  cookie: string | null
  acceptLanguage: string | null
}

export function primaryLanguage(acceptLanguage: string | null): string | null {
  const first = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim().toLowerCase()
  return first ? (first.split('-')[0] ?? null) : null
}

function isPage(path: string): boolean {
  if (/^\/(api|_astro|_taac|icons)(\/|$)/.test(path)) return false
  const last = path.split('/').pop() ?? ''
  return !last.includes('.') || last.endsWith('.html')
}

/** Where to send an unprefixed page request, or null to serve it as is. */
export function languageRedirect(input: RedirectInput, manifest: AccessManifest): string | null {
  if (input.method !== 'GET' || !input.accept?.includes('text/html') || !isPage(input.path)) return null
  if (splitLocale(input.path, manifest).locale) return null
  const supported = manifest.locales.filter((l) => l !== manifest.defaultLocale)
  const remembered = readCookie(input.cookie, LANG_COOKIE)
  const lang = remembered ?? primaryLanguage(input.acceptLanguage)
  if (!lang || !supported.includes(lang)) return null
  return `/${lang}${input.path}${input.search}`
}

/** UI language for server-rendered pages. */
export function pageLanguage(
  path: string,
  cookie: string | null,
  acceptLanguage: string | null,
  manifest: AccessManifest,
): string {
  const remembered = readCookie(cookie, LANG_COOKIE)
  if (remembered && manifest.locales.includes(remembered)) return remembered
  const prefixed = splitLocale(path, manifest).locale
  if (prefixed) return prefixed
  const primary = primaryLanguage(acceptLanguage)
  return primary && manifest.locales.includes(primary) ? primary : manifest.defaultLocale
}

export interface LoginStrings {
  lead: string
  github: string
  error: string
  notOnSite: string
  notOnTrip: string
  home: string
  switch: string
}

const STRINGS: Record<string, LoginStrings> = {
  en: {
    lead: 'This site is private. Sign in with GitHub to continue.',
    github: 'Sign in with GitHub',
    error: 'Signing in didn’t work. Try again.',
    notOnSite: '{login} isn’t on any trip here.',
    notOnTrip: 'This trip isn’t shared with {login}.',
    home: 'All trips',
    switch: 'Use another account',
  },
  ru: {
    lead: 'Этот сайт закрыт. Войдите через GitHub, чтобы продолжить.',
    github: 'Войти через GitHub',
    error: 'Не удалось войти. Попробуйте ещё раз.',
    notOnSite: '{login} не участвует ни в одной поездке.',
    notOnTrip: 'Эта поездка не открыта для {login}.',
    home: 'Все поездки',
    switch: 'Войти в другой аккаунт',
  },
}

export function loginStrings(lang: string): LoginStrings {
  return STRINGS[lang] ?? STRINGS.en!
}
