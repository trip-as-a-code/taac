/**
 * Signed session cookies, WebCrypto only. A session names the GitHub account
 * that signed in; it is signed with SESSION_SECRET, so rotating that secret
 * signs everyone out.
 */

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60
export const SESSION_COOKIE = 'taac_session'
/** Readable by the page (the session itself is not), so it can show "sign out" before its scripts run. */
export const SIGNED_IN_COOKIE = 'taac_signed_in'
/** Guards the GitHub round trip against forged callbacks. */
export const STATE_COOKIE = 'taac_oauth'

export interface Session {
  /** Lowercase GitHub username. */
  login: string
  /** Expiry, epoch seconds. */
  exp: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

function fromBase64url(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** `<payload>.<signature>`, both base64url. */
export async function signSession(sessionSecret: string, session: Session): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify({ login: session.login, exp: session.exp })))
  return `${payload}.${base64url(await hmac(encoder.encode(sessionSecret), `session|${payload}`))}`
}

export async function verifySession(
  value: string | null | undefined,
  sessionSecret: string,
  nowSec: number,
): Promise<Session | null> {
  const [payload, signature, extra] = value?.split('.') ?? []
  if (!payload || !signature || extra !== undefined) return null
  const expected = base64url(await hmac(encoder.encode(sessionSecret), `session|${payload}`))
  if (!equalBytes(encoder.encode(signature), encoder.encode(expected))) return null
  const bytes = fromBase64url(payload)
  if (!bytes) return null
  try {
    const session = JSON.parse(decoder.decode(bytes)) as Partial<Session>
    if (typeof session.login !== 'string' || typeof session.exp !== 'number' || session.exp < nowSec) return null
    return { login: session.login, exp: session.exp }
  } catch {
    return null
  }
}

/** A random value for the GitHub round trip's `state`. */
export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(24)))
}

export function sameState(a: string | null, b: string | null): boolean {
  return !!a && !!b && equalBytes(encoder.encode(a), encoder.encode(b))
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

function attributes(secure: boolean): string {
  return `Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** The session (HttpOnly) and the page-readable marker that someone is signed in. */
export function sessionCookies(value: string, secure: boolean): string[] {
  return [
    `${SESSION_COOKIE}=${value}; HttpOnly; ${attributes(secure)}; Max-Age=${SESSION_MAX_AGE}`,
    `${SIGNED_IN_COOKIE}=1; ${attributes(secure)}; Max-Age=${SESSION_MAX_AGE}`,
  ]
}

/** Lives for the GitHub round trip only. */
export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${value}; HttpOnly; ${attributes(secure)}; Max-Age=600`
}

export function clearedCookie(name: string, secure: boolean): string {
  return `${name}=; HttpOnly; ${attributes(secure)}; Max-Age=0`
}
