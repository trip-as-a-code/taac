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
  linkGone: string
  linkGoneLead: string
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
    linkGone: 'This link no longer works',
    linkGoneLead: 'It expired or was revoked. Ask whoever sent it for a new one, or sign in.',
  },
  ru: {
    lead: 'Этот сайт закрыт. Войдите через GitHub, чтобы продолжить.',
    github: 'Войти через GitHub',
    error: 'Не удалось войти. Попробуйте ещё раз.',
    notOnSite: '{login} не участвует ни в одной поездке.',
    notOnTrip: 'Эта поездка не открыта для {login}.',
    home: 'Все поездки',
    switch: 'Войти в другой аккаунт',
    linkGone: 'Ссылка больше не работает',
    linkGoneLead: 'Срок её действия истёк, или её отозвали. Попросите новую у того, кто её прислал, или войдите.',
  },
}

/** Browser notifications, `{name}` being who did it. */
export interface PushStrings {
  thread: string
  reply: string
  resolved: string
  /** The one sent to check they arrive: its title (never the site's name, which the system already shows) and text. */
  testTitle: string
  test: string
  change: string
  /** A change GitHub couldn't put a name to. */
  changeAnon: string
  /** What is due, `{rel}` being when (“tomorrow”, “in 3 days”). */
  due: Record<'booking' | 'payment' | 'task', string>
  /** What is past due, `{date}` being the deadline. */
  overdue: Record<'booking' | 'payment' | 'task', string>
  /** The rest of a push's list. */
  more: string
}

const PUSH: Record<string, PushStrings> = {
  en: {
    thread: '{name} started a discussion',
    reply: '{name} replied',
    resolved: '{name} resolved a discussion',
    testTitle: 'Notifications are on',
    test: 'Replies, plan changes and deadline reminders will show up here.',
    change: '{name} changed the plan',
    changeAnon: 'The plan changed',
    due: { booking: 'Booking due {rel}', payment: 'Payment due {rel}', task: 'Task due {rel}' },
    overdue: {
      booking: 'Booking overdue since {date}',
      payment: 'Charged {date}? Add the amount',
      task: 'Task overdue since {date}',
    },
    more: '+{n} more',
  },
  ru: {
    thread: '{name}: новое обсуждение',
    reply: '{name}: ответ',
    resolved: '{name}: обсуждение решено',
    testTitle: 'Уведомления включены',
    test: 'Сюда будут приходить ответы, изменения в плане и напоминания о сроках.',
    change: '{name}: изменения в плане',
    changeAnon: 'Изменения в плане',
    due: { booking: 'Срок бронирования — {rel}', payment: 'Оплата — {rel}', task: 'Срок задачи — {rel}' },
    overdue: {
      booking: 'Бронирование просрочено с {date}',
      payment: 'Списано {date}? Укажите сумму',
      task: 'Задача просрочена с {date}',
    },
    more: 'и ещё {n}',
  },
}

export function pushStrings(lang: string): PushStrings {
  return PUSH[lang] ?? PUSH.en!
}

export function loginStrings(lang: string): LoginStrings {
  return STRINGS[lang] ?? STRINGS.en!
}
