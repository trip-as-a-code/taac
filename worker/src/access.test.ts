import { describe, expect, it } from 'vitest'

import {
  calendarSlug,
  isPublicPath,
  normalise,
  parseScope,
  requiredScopes,
  sanitizeNext,
  splitLocale,
  tripOf,
} from './access'

const manifest = normalise({
  title: 'Trips',
  site: { secret: 'SITE_PASSWORD' },
  trips: { japan: { secret: 'JAPAN_PASSWORD', title: 'Japan' } },
  locales: ['en', 'ru'],
  defaultLocale: 'en',
})
const tripOnly = { ...manifest, site: null }

describe('path classification', () => {
  it('requires the site scope everywhere but public paths', () => {
    expect(requiredScopes('/', manifest)).toEqual(['site'])
    expect(requiredScopes('/_astro/app.js', manifest)).toEqual(['site'])
    expect(requiredScopes('/api/fx', manifest)).toEqual(['site'])
    for (const path of ['/login', '/ru/login', '/api/login', '/api/logout', '/favicon.svg', '/icons/192.png']) {
      expect(isPublicPath(path, manifest)).toBe(true)
      expect(requiredScopes(path, manifest)).toEqual([])
    }
  })

  it('stacks trip scopes under the site scope, in every locale', () => {
    expect(requiredScopes('/trips/japan/', manifest)).toEqual(['site', 'trip:japan'])
    expect(requiredScopes('/ru/trips/japan/map/', manifest)).toEqual(['site', 'trip:japan'])
    expect(requiredScopes('/trips/japan', tripOnly)).toEqual(['trip:japan'])
    expect(requiredScopes('/trips/lisbon/', tripOnly)).toEqual([])
    expect(requiredScopes('/trips/japanese/', tripOnly)).toEqual([])
  })

  it('splits locales and finds trips', () => {
    expect(splitLocale('/ru', manifest)).toEqual({ locale: 'ru', rest: '/' })
    expect(splitLocale('/run/', manifest)).toEqual({ locale: null, rest: '/run/' })
    expect(tripOf('/ru/trips/japan/budget/', manifest)).toBe('japan')
    expect(calendarSlug('/trips/japan/calendar.ics')).toBe('japan')
    expect(calendarSlug('/ru/trips/japan/calendar.ics')).toBeNull()
  })
})

describe('scopes', () => {
  it('only accepts configured scopes', () => {
    expect(parseScope('site', manifest)).toBe('site')
    expect(parseScope('site', tripOnly)).toBeNull()
    expect(parseScope('trip:japan', manifest)).toBe('trip:japan')
    expect(parseScope('trip:nope', manifest)).toBeNull()
    expect(parseScope(null, manifest)).toBeNull()
  })
})

describe('sanitizeNext', () => {
  it('keeps same-origin paths only', () => {
    expect(sanitizeNext('/trips/japan/?day=2', '/')).toBe('/trips/japan/?day=2')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'trips', '', null, '/a\nb']) {
      expect(sanitizeNext(bad, '/ru/')).toBe('/ru/')
    }
  })
})

describe('manifest', () => {
  it('normalises a missing or partial manifest to no protection', () => {
    const empty = normalise(undefined)
    expect(empty.site).toBeNull()
    expect(empty.trips).toEqual({})
    expect(requiredScopes('/trips/japan/', empty)).toEqual([])
  })
})

describe('localized titles', () => {
  it('accepts per-language titles and falls back to English', async () => {
    const { normalise, localizedText } = await import('./access')
    const manifest = normalise({ title: { en: 'Trips', ru: 'Поездки' } })
    expect(localizedText(manifest.title, 'ru')).toBe('Поездки')
    expect(localizedText(manifest.title, 'de')).toBe('Trips')
    expect(localizedText(normalise({ title: 'Plain' }).title, 'ru')).toBe('Plain')
  })
})
