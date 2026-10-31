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

/** `<payload>.<signature>`, both base64url; `purpose` keeps one kind from passing for another. */
export async function signValue(secret: string, purpose: string, value: object): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(value)))
  return `${payload}.${base64url(await hmac(encoder.encode(secret), `${purpose}|${payload}`))}`
}

/** The signed value, or null when it was tampered with or isn't one. */
export async function verifyValue(
  value: string | null | undefined,
  secret: string,
  purpose: string,
): Promise<Record<string, unknown> | null> {
  const [payload, signature, extra] = value?.split('.') ?? []
  if (!payload || !signature || extra !== undefined) return null
  const expected = base64url(await hmac(encoder.encode(secret), `${purpose}|${payload}`))
  if (!equalBytes(encoder.encode(signature), encoder.encode(expected))) return null
  const bytes = fromBase64url(payload)
  if (!bytes) return null
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function signSession(sessionSecret: string, session: Session): Promise<string> {
  return signValue(sessionSecret, 'session', { login: session.login, exp: session.exp })
}

export async function verifySession(
  value: string | null | undefined,
  sessionSecret: string,
  nowSec: number,
): Promise<Session | null> {
  const session = await verifyValue(value, sessionSecret, 'session')
  if (typeof session?.login !== 'string' || typeof session.exp !== 'number' || session.exp < nowSec) return null
  return { login: session.login, exp: session.exp }
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

/** A view-only link opened in this browser; HttpOnly, checked against the link on every request. */
export const LINK_COOKIE = 'taac_link'

export function linkCookie(value: string, secure: boolean, maxAge: number): string {
  return `${LINK_COOKIE}=${value}; HttpOnly; ${attributes(secure)}; Max-Age=${maxAge}`
}

/** Lives for the GitHub round trip only. */
export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${value}; HttpOnly; ${attributes(secure)}; Max-Age=600`
}

export function clearedCookie(name: string, secure: boolean): string {
  return `${name}=; HttpOnly; ${attributes(secure)}; Max-Age=0`
}
