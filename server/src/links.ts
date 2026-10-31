/**
 * View-only links. A member makes one for a trip, labelled and for a while
 * (or for good); anyone who opens it sees that trip, read-only, until it
 * expires or any member revokes it. Opening it leaves a signed cookie naming
 * the link, and every request checks the link is still good.
 */

import { base64url, signValue, verifyValue } from './auth'

export interface ShareLink {
  id: string
  trip: string
  token: string
  label: string
  /** Lowercase GitHub login. */
  createdBy: string
  /** Epoch milliseconds. */
  createdAt: number
  /** Null: never expires. */
  expiresAt: number | null
  revokedAt: number | null
  revokedBy: string | null
  lastUsedAt: number | null
}

export interface LinkStore {
  createLink(link: ShareLink): Promise<void>
  /** The trip's links that still work. */
  links(trip: string, now: number): Promise<ShareLink[]>
  linkByToken(token: string): Promise<ShareLink | null>
  linkById(id: string): Promise<ShareLink | null>
  /** False when there was no such working link. */
  revokeLink(trip: string, id: string, by: string, now: number): Promise<boolean>
  touchLink(id: string, now: number): Promise<void>
}

const DAY = 24 * 60 * 60 * 1000
export const LIFETIMES: Record<string, number | null> = { '1d': DAY, '1w': 7 * DAY, '1m': 30 * DAY, never: null }
export const MAX_LINKS = 100
const LABEL_MAX = 60
/** How long the cookie of a link that never expires lasts; it is still checked on every request. */
const FOREVER_SECONDS = 365 * 24 * 60 * 60

export function works(link: ShareLink | null, now: number): link is ShareLink {
  return !!link && link.revokedAt === null && (link.expiresAt === null || link.expiresAt > now)
}

export function newLink(trip: string, label: unknown, lifetime: unknown, by: string, now: number): ShareLink | null {
  if (typeof lifetime !== 'string' || !(lifetime in LIFETIMES)) return null
  const span = LIFETIMES[lifetime]!
  const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)))
  return {
    id: random(9),
    trip,
    token: random(24),
    label: typeof label === 'string' ? label.trim().slice(0, LABEL_MAX) : '',
    createdBy: by,
    createdAt: now,
    expiresAt: span === null ? null : now + span,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
  }
}

/** What members see of a link, the address included. */
export function describe(link: ShareLink, origin: string) {
  return {
    id: link.id,
    label: link.label,
    url: `${origin}/s/${link.token}`,
    createdBy: link.createdBy,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    lastUsedAt: link.lastUsedAt,
  }
}

/** `/s/<token>` → the token. */
export function linkToken(path: string): string | null {
  return /^\/s\/([A-Za-z0-9_-]{16,64})$/.exec(path)?.[1] ?? null
}

/** `/api/trips/<slug>/links[/<id>]`. */
export function linksRoute(path: string): { slug: string; id: string | null } | null {
  const match = /^\/api\/trips\/([^/]+)\/links(?:\/([A-Za-z0-9_-]{1,32}))?$/.exec(path)
  return match?.[1] ? { slug: decodeURIComponent(match[1]), id: match[2] ?? null } : null
}

export function signLinkCookie(secret: string, link: ShareLink): Promise<string> {
  return signValue(secret, 'link', { id: link.id, trip: link.trip })
}

export function linkCookieAge(link: ShareLink, now: number): number {
  return link.expiresAt === null ? FOREVER_SECONDS : Math.max(1, Math.ceil((link.expiresAt - now) / 1000))
}

export async function verifyLinkCookie(
  value: string | null,
  secret: string,
): Promise<{ id: string; trip: string } | null> {
  const parsed = await verifyValue(value, secret, 'link')
  return typeof parsed?.id === 'string' && typeof parsed.trip === 'string' ? { id: parsed.id, trip: parsed.trip } : null
}
