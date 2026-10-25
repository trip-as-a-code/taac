import { describe, expect, it } from 'vitest'

import { calendarKey, passwordMatches, readCookie, sessionCookie, signSession, verifySession } from './auth'

const SECRET = 'session-secret-for-tests'
const NOW = 1_800_000_000

describe('sessions', () => {
  it('round-trips a signed session', async () => {
    const value = await signSession(SECRET, 'pw', 'site', NOW + 60)
    expect(await verifySession(value, SECRET, 'pw', 'site', NOW)).toBe(true)
  })

  it('rejects expired sessions', async () => {
    const value = await signSession(SECRET, 'pw', 'site', NOW - 1)
    expect(await verifySession(value, SECRET, 'pw', 'site', NOW)).toBe(false)
  })

  it('rejects tampering', async () => {
    const value = await signSession(SECRET, 'pw', 'site', NOW + 60)
    const [exp, sig] = value.split('.')
    expect(await verifySession(`${Number(exp) + 3600}.${sig}`, SECRET, 'pw', 'site', NOW)).toBe(false)
    expect(await verifySession(`${exp}.${sig!.slice(0, -1)}A`, SECRET, 'pw', 'site', NOW)).toBe(false)
    expect(await verifySession('garbage', SECRET, 'pw', 'site', NOW)).toBe(false)
    expect(await verifySession(null, SECRET, 'pw', 'site', NOW)).toBe(false)
  })

  it('is invalidated by rotating the password or the session secret', async () => {
    const value = await signSession(SECRET, 'pw', 'site', NOW + 60)
    expect(await verifySession(value, SECRET, 'new-pw', 'site', NOW)).toBe(false)
    expect(await verifySession(value, 'other-secret', 'pw', 'site', NOW)).toBe(false)
  })

  it('is bound to its scope', async () => {
    const value = await signSession(SECRET, 'pw', 'trip:japan', NOW + 60)
    expect(await verifySession(value, SECRET, 'pw', 'trip:lisbon', NOW)).toBe(false)
    expect(await verifySession(value, SECRET, 'pw', 'site', NOW)).toBe(false)
  })

  it('writes hardened cookies', () => {
    const cookie = sessionCookie('trip:japan', 'v')
    expect(cookie).toMatch(/^taac_trip_japan=v; /)
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000'])
      expect(cookie).toContain(attr)
    expect(readCookie('a=1; taac_site=x.y=z; b=2', 'taac_site')).toBe('x.y=z')
  })
})

describe('passwords and calendar keys', () => {
  it('compares passwords', async () => {
    expect(await passwordMatches('secret', 'secret')).toBe(true)
    expect(await passwordMatches('secret', 'secreT')).toBe(false)
    expect(await passwordMatches('', 'secret')).toBe(false)
  })

  it('derives stable per-trip calendar keys', async () => {
    const key = await calendarKey(SECRET, 'japan')
    expect(key).toHaveLength(32)
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await calendarKey(SECRET, 'japan')).toBe(key)
    expect(await calendarKey(SECRET, 'lisbon')).not.toBe(key)
    expect(await calendarKey('other', 'japan')).not.toBe(key)
  })
})
