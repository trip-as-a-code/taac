import { describe, expect, it } from 'vitest'

import {
  calendarSlug,
  decide,
  decideVault,
  isPublicPath,
  localizedText,
  normalise,
  sanitizeNext,
  splitLocale,
  tripOf,
  visibleTrips,
} from './access'

const manifest = normalise({
  title: 'Trips',
  auth: 'github',
  trips: {
    japan: { title: 'Japan', public: false, logins: ['Alex', 'robin'] },
    lisbon: { title: 'Lisbon', public: true, logins: [] },
  },
  slugs: ['japan', 'lisbon'],
  locales: ['en', 'ru'],
  defaultLocale: 'en',
})

describe('who sees what', () => {
  it('asks the signed-out to sign in, except on public paths and public trips', () => {
    expect(decide('/', null, manifest)).toBe('sign-in')
    expect(decide('/_astro/app.js', null, manifest)).toBe('sign-in')
    expect(decide('/ru/trips/japan/map/', null, manifest)).toBe('sign-in')
    expect(decide('/trips/lisbon/', null, manifest)).toBe('open')
    for (const path of [
      '/login',
      '/ru/login',
      '/api/auth/github',
      '/api/auth/callback',
      '/api/me',
      '/healthz',
      '/icons/192.png',
    ])
      expect(isPublicPath(path, manifest)).toBe(true)
  })

  it('lets a trip’s people in, case-insensitively, and nobody else', () => {
    expect(decide('/trips/japan/', 'alex', manifest)).toBe('open')
    expect(decide('/trips/japan/', 'stranger', manifest)).toBe('forbidden')
    // The site itself is for whoever is on some trip.
    expect(decide('/', 'robin', manifest)).toBe('open')
    expect(decide('/', 'stranger', manifest)).toBe('forbidden')
    expect(visibleTrips('robin', manifest)).toEqual(['japan', 'lisbon'])
    expect(visibleTrips('stranger', manifest)).toEqual(['lisbon'])
  })

  it('opens everything on a public site', () => {
    const open = normalise({ trips: { japan: { logins: ['a'] } }, slugs: ['japan'] })
    expect(open.auth).toBeNull()
    expect(decide('/trips/japan/', null, open)).toBe('open')
  })

  it('splits locales and finds trips', () => {
    expect(splitLocale('/ru', manifest)).toEqual({ locale: 'ru', rest: '/' })
    expect(splitLocale('/run/', manifest)).toEqual({ locale: null, rest: '/run/' })
    expect(tripOf('/ru/trips/japan/budget/', manifest)).toBe('japan')
    expect(calendarSlug('/trips/japan/calendar.ics')).toBe('japan')
    expect(calendarSlug('/trips/japan/calendar-robin.ics')).toBe('japan')
    expect(calendarSlug('/trips/japan/calendar-../x.ics')).toBeNull()
    expect(calendarSlug('/ru/trips/japan/calendar.ics')).toBeNull()
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
  it('normalises a missing or partial manifest to everything open', () => {
    const empty = normalise(undefined)
    expect(empty.auth).toBeNull()
    expect(empty.trips).toEqual({})
  })

  it('accepts per-language titles and falls back to English', () => {
    const titled = normalise({ title: { en: 'Trips', ru: 'Поездки' } })
    expect(localizedText(titled.title, 'ru')).toBe('Поездки')
    expect(localizedText(titled.title, 'de')).toBe('Trips')
    expect(localizedText(normalise({ title: 'Plain' }).title, 'ru')).toBe('Plain')
  })

  it('enforces defense-in-depth access rules for personal and shared .kdbx vaults', () => {
    const manifest = normalise({
      auth: 'github',
      vaults: {
        alex: { ownerLogins: ['Alex'] },
        duo: { ownerLogins: ['Sam', 'Robin'] },
      },
      trips: {
        lisbon: {
          title: 'Lisbon',
          public: false,
          logins: ['alex', 'robin'],
          roles: { alex: 'member', robin: 'viewer' },
          vault: { share: true, viewers: false },
        },
        tokyo: {
          title: 'Tokyo',
          public: false,
          logins: ['alex', 'robin'],
          roles: { alex: 'member', robin: 'viewer' },
          vault: { share: false, viewers: true },
        },
      },
      slugs: ['lisbon', 'tokyo'],
      locales: ['en', 'ru'],
      defaultLocale: 'en',
    })

    // Personal and multi-owner sub-group vaults: only declared owners when signed in; never via share link or other members.
    expect(decideVault('/vaults/alex.kdbx', 'alex', null, manifest)).toBe('open')
    expect(decideVault('/vaults/alex.kdbx', 'robin', null, manifest)).toBe('forbidden')
    expect(decideVault('/vaults/alex.kdbx', null, 'lisbon', manifest)).toBe('sign-in')
    expect(decideVault('/vaults/duo.kdbx', 'sam', null, manifest)).toBe('open')
    expect(decideVault('/vaults/duo.kdbx', 'robin', null, manifest)).toBe('open')
    expect(decideVault('/vaults/duo.kdbx', 'alex', null, manifest)).toBe('forbidden')
    expect(decideVault('/vaults/unknown.kdbx', 'alex', null, manifest)).toBe('forbidden')

    // Shared trip vault with share: true, viewers: false.
    expect(decideVault('/trips/lisbon/vault.kdbx', 'alex', null, manifest)).toBe('open')
    expect(decideVault('/trips/lisbon/vault.kdbx', 'robin', null, manifest)).toBe('forbidden')
    expect(decideVault('/trips/lisbon/vault.kdbx', null, 'lisbon', manifest)).toBe('open')
    expect(decideVault('/trips/lisbon/vault.kdbx', null, 'tokyo', manifest)).toBe('sign-in')

    // Shared trip vault with share: false, viewers: true.
    expect(decideVault('/trips/tokyo/vault.kdbx', 'robin', null, manifest)).toBe('open')
    expect(decideVault('/trips/tokyo/vault.kdbx', null, 'tokyo', manifest)).toBe('forbidden')

    // Non-vault paths return null.
    expect(decideVault('/trips/lisbon/itinerary/', 'alex', null, manifest)).toBeNull()
  })
})
