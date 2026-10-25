/**
 * Signed session cookies and password checks, WebCrypto only so the same
 * code runs in the Worker and in tests. The signing key is derived from
 * SESSION_SECRET *and* the password, so rotating a password logs everyone
 * out of that scope.
 */

import { cookieName, type Scope } from './access'

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60

const encoder = new TextEncoder()

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
}

async function sessionKey(sessionSecret: string, password: string): Promise<ArrayBuffer> {
  return hmac(encoder.encode(sessionSecret), password)
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** Constant-time over SHA-256 digests, so length leaks nothing either. */
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  return equalBytes(new Uint8Array(a), new Uint8Array(b))
}

export async function signSession(sessionSecret: string, password: string, scope: Scope, exp: number): Promise<string> {
  const signature = await hmac(await sessionKey(sessionSecret, password), `${scope}|${exp}`)
  return `${exp}.${base64url(signature)}`
}

export async function verifySession(
  value: string | null | undefined,
  sessionSecret: string,
  password: string,
  scope: Scope,
  nowSec: number,
): Promise<boolean> {
  if (!value) return false
  const dot = value.indexOf('.')
  if (dot <= 0) return false
  const exp = Number(value.slice(0, dot))
  if (!Number.isInteger(exp) || exp < nowSec) return false
  const expected = await signSession(sessionSecret, password, scope, exp)
  return equalBytes(encoder.encode(value), encoder.encode(expected))
}

export async function calendarKey(sessionSecret: string, slug: string): Promise<string> {
  return base64url(await hmac(encoder.encode(sessionSecret), `calendar:${slug}`)).slice(0, 32)
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function cookieNames(header: string | null): string[] {
  if (!header) return []
  return header
    .split(';')
    .map((part) => part.trim().split('=')[0] ?? '')
    .filter(Boolean)
}

export function sessionCookie(scope: Scope, value: string): string {
  return `${cookieName(scope)}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`
}

export function clearedCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}
