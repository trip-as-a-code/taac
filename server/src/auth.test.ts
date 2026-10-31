import { describe, expect, it } from 'vitest'

import { calendarKey, readCookie, sameState, sessionCookies, signSession, verifySession } from './auth'

describe('sessions', () => {
  it('round-trips a signed session until it expires', async () => {
    const value = await signSession('secret', { login: 'alex', exp: 1000 })
    expect(await verifySession(value, 'secret', 999)).toEqual({ login: 'alex', exp: 1000 })
    expect(await verifySession(value, 'secret', 1001)).toBeNull()
  })

  it('rejects another secret, tampering and garbage', async () => {
    const value = await signSession('secret', { login: 'alex', exp: 1000 })
    expect(await verifySession(value, 'other', 1)).toBeNull()
    const [payload, signature] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ login: 'robin', exp: 1000 })).toString('base64url')
    expect(await verifySession(`${forged}.${signature}`, 'secret', 1)).toBeNull()
    expect(await verifySession(`${payload}.${signature}.x`, 'secret', 1)).toBeNull()
    for (const bad of [null, '', 'x', 'a.b']) expect(await verifySession(bad, 'secret', 1)).toBeNull()
  })

  it('sets the session HttpOnly and the marker readable', () => {
    const [session, marker] = sessionCookies('v', true)
    expect(session).toMatch(/^taac_session=v; HttpOnly; Path=\/; SameSite=Lax; Secure; Max-Age=/)
    expect(marker).toMatch(/^taac_signed_in=1; Path=\/; SameSite=Lax; Secure; Max-Age=/)
    expect(sessionCookies('v', false)[0]).not.toContain('Secure')
  })
})

describe('helpers', () => {
  it('keys calendars per trip', async () => {
    const japan = await calendarKey('secret', 'japan')
    expect(japan).toHaveLength(32)
    expect(await calendarKey('secret', 'lisbon')).not.toBe(japan)
  })

  it('reads cookies and compares states', () => {
    expect(readCookie('a=1; taac_session=x.y', 'taac_session')).toBe('x.y')
    expect(readCookie(null, 'a')).toBeNull()
    expect(sameState('abc', 'abc')).toBe(true)
    expect(sameState('abc', 'abd')).toBe(false)
    expect(sameState(null, null)).toBe(false)
  })
})
