import { describe, expect, it } from 'vitest'

import { normalise } from './access'
import { languageRedirect, pageLanguage, primaryLanguage, type RedirectInput } from './i18n'

const manifest = normalise({ title: 'T', site: null, trips: {}, locales: ['en', 'ru'], defaultLocale: 'en' })
const base: RedirectInput = {
  method: 'GET',
  path: '/trips/japan/',
  search: '?day=1',
  accept: 'text/html,application/xhtml+xml',
  cookie: null,
  acceptLanguage: null,
}

describe('languageRedirect', () => {
  it('follows the remembered language', () => {
    expect(languageRedirect({ ...base, cookie: 'taac_lang=ru' }, manifest)).toBe('/ru/trips/japan/?day=1')
    expect(languageRedirect({ ...base, path: '/', search: '', cookie: 'taac_lang=ru' }, manifest)).toBe('/ru/')
  })

  it('lets a remembered default language override the browser', () => {
    expect(languageRedirect({ ...base, cookie: 'taac_lang=en', acceptLanguage: 'ru-RU,ru;q=0.9' }, manifest)).toBeNull()
  })

  it('falls back to Accept-Language', () => {
    expect(languageRedirect({ ...base, acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.8' }, manifest)).toBe(
      '/ru/trips/japan/?day=1',
    )
    expect(languageRedirect({ ...base, acceptLanguage: 'en-GB,ru;q=0.9' }, manifest)).toBeNull()
    expect(languageRedirect({ ...base, acceptLanguage: 'de' }, manifest)).toBeNull()
  })

  it('signed in, serves every page in the account’s language, whatever the address or the browser says', () => {
    const signedIn = { ...base, cookie: 'taac_lang=en', acceptLanguage: 'en-GB' }
    expect(languageRedirect(signedIn, manifest, 'ru')).toBe('/ru/trips/japan/?day=1')
    expect(languageRedirect({ ...signedIn, path: '/ru/trips/japan/' }, manifest, 'en')).toBe('/trips/japan/?day=1')
    expect(languageRedirect({ ...signedIn, path: '/ru', search: '' }, manifest, 'en')).toBe('/')
    expect(languageRedirect({ ...signedIn, path: '/ru/trips/japan/' }, manifest, 'ru')).toBeNull()
    expect(languageRedirect({ ...signedIn, accept: 'application/json' }, manifest, 'ru')).toBeNull()
    // No language on the account yet: the browser's, as signed out.
    expect(languageRedirect({ ...base, cookie: 'taac_lang=ru' }, manifest, null)).toBe('/ru/trips/japan/?day=1')
  })

  it('never redirects explicit locale paths, assets or non-navigations', () => {
    const ru = { ...base, cookie: 'taac_lang=ru' }
    expect(languageRedirect({ ...ru, path: '/ru/trips/japan/' }, manifest)).toBeNull()
    expect(languageRedirect({ ...base, path: '/ru/', cookie: 'taac_lang=en' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, path: '/_astro/x.css' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, path: '/api/fx' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, path: '/trips/japan/calendar.ics' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, accept: '*/*' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, method: 'POST' }, manifest)).toBeNull()
    expect(languageRedirect({ ...ru, path: '/about.html' }, manifest)).toBe('/ru/about.html?day=1')
  })
})

describe('pageLanguage', () => {
  it('prefers cookie, then path, then browser', () => {
    expect(pageLanguage('/login', 'taac_lang=ru', 'en', manifest)).toBe('ru')
    expect(pageLanguage('/ru/login', null, 'en', manifest)).toBe('ru')
    expect(pageLanguage('/login', null, 'ru;q=1', manifest)).toBe('ru')
    expect(pageLanguage('/login', 'taac_lang=xx', 'de', manifest)).toBe('en')
  })

  it('parses Accept-Language', () => {
    expect(primaryLanguage('ru-RU,ru;q=0.9')).toBe('ru')
    expect(primaryLanguage(null)).toBeNull()
  })
})
