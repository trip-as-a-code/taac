import { en, type MessageKey, type Messages } from './en'
import { ru } from './ru'

export const locales = ['en', 'ru'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

export const localeNames: Record<Locale, string> = { en: 'English', ru: 'Русский' }

const catalogs: Record<Locale, Messages> = { en: en as Messages, ru }

/** Picks a `Text` for a language: exact, then English, then the first. */
export function localized(text: string | Record<string, string> | undefined, lang: string): string {
  if (text === undefined || typeof text === 'string') return text ?? ''
  return text[lang] ?? text.en ?? Object.values(text)[0] ?? ''
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

/** `[...lang]` route param → locale (undefined is the default locale). */
export function localeFromParam(param: string | undefined): Locale {
  return isLocale(param) ? param : defaultLocale
}

export function langParams() {
  return locales.map((lang) => ({ lang: lang === defaultLocale ? undefined : lang }))
}

/** Prefixes a root-relative path with the locale segment, if any. */
export function localePath(lang: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return lang === defaultLocale ? clean : `/${lang}${clean === '/' ? '/' : clean}`
}

/** The same page in another locale. */
export function switchLocalePath(pathname: string, target: Locale): string {
  const segments = pathname.split('/')
  const bare = isLocale(segments[1]) ? '/' + segments.slice(2).join('/') : pathname
  return localePath(target, bare || '/')
}

const fill = (template: string, vars: Record<string, string | number> = {}) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))

export function useI18n(lang: Locale) {
  const messages = catalogs[lang]
  const plurals = new Intl.PluralRules(lang)

  function t(key: MessageKey, vars?: Record<string, string | number>): string {
    const message = messages[key]
    return typeof message === 'string' ? fill(message, vars) : fill(message.other, vars)
  }

  function plural(key: MessageKey, n: number, vars?: Record<string, string | number>): string {
    const message = messages[key]
    if (typeof message === 'string') return fill(message, { n, ...vars })
    const form = plurals.select(n) as keyof typeof message
    return fill(message[form] ?? message.other, { n: number(n), ...vars })
  }

  function number(n: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(lang, options).format(n)
  }

  function money(amount: number, currency: string, options: Intl.NumberFormatOptions = {}): string {
    const fractional = !['JPY', 'KRW', 'VND', 'ISK', 'HUF'].includes(currency)
    const maximumFractionDigits = options.maximumFractionDigits ?? (fractional ? 2 : 0)
    const minimumFractionDigits = Math.min(maximumFractionDigits, fractional && amount % 1 !== 0 ? 2 : 0)
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency,
      ...options,
      maximumFractionDigits,
      minimumFractionDigits,
    }).format(amount)
  }

  /** Formats a date-only ISO string without shifting it through a time zone. */
  function date(iso: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
    return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', ...options }).format(new Date(`${iso}T00:00:00Z`))
  }

  function dateRange(start?: string, end?: string): string {
    if (!start) return ''
    if (!end || start === end) return date(start, { day: 'numeric', month: 'long', year: 'numeric' })
    const format = new Intl.DateTimeFormat(lang, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
    return format.formatRange(new Date(`${start}T00:00:00Z`), new Date(`${end}T00:00:00Z`))
  }

  /** A message's plural forms as JSON, for scripts that count on the client. */
  function forms(key: MessageKey): string {
    const message = messages[key]
    return JSON.stringify(typeof message === 'string' ? { other: message } : message)
  }

  return { lang, t, plural, forms, number, money, date, dateRange, path: (p: string) => localePath(lang, p) }
}

export type I18n = ReturnType<typeof useI18n>
