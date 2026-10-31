/**
 * Discussions: threads anchored anywhere on a trip, each a flat list of
 * comments by GitHub-verified members. A thread is resolved and reopened by
 * anyone who may comment; a comment is edited or deleted by its author.
 */

import { base64url } from './auth'

export interface Comment {
  id: string
  author: string
  /** Empty once deleted. */
  body: string
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
}

export interface Thread {
  id: string
  trip: string
  anchor: string
  createdBy: string
  createdAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  comments: Comment[]
}

export interface CommentStore {
  threads(trip: string): Promise<Thread[]>
  thread(id: string): Promise<Thread | null>
  createThread(thread: Thread): Promise<void>
  addComment(threadId: string, comment: Comment): Promise<void>
  resolveThread(id: string, by: string | null, now: number): Promise<void>
  editComment(id: string, body: string, now: number): Promise<void>
  deleteComment(id: string, now: number): Promise<void>
  /** The comment and its thread's trip, for permission checks. */
  comment(id: string): Promise<(Comment & { trip: string }) | null>
}

const ANCHOR = /^[A-Za-z][\w:.+-]{0,119}$/
const BODY_MAX = 4000
export const MAX_THREADS = 2000

export const newId = () => base64url(crypto.getRandomValues(new Uint8Array(12)))

export function validAnchor(anchor: unknown): anchor is string {
  return typeof anchor === 'string' && ANCHOR.test(anchor)
}

/** Trimmed text of 1–4000 characters, or null. */
export function validBody(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const text = body.trim()
  return text.length > 0 && text.length <= BODY_MAX ? text : null
}

export function newComment(author: string, body: string, now: number): Comment {
  return { id: newId(), author, body, createdAt: now, editedAt: null, deletedAt: null }
}

/** `/api/trips/<slug>/threads[/<id>[/comments]]` and `/api/trips/<slug>/comments/<id>`. */
export type CommentsRoute =
  | { slug: string; kind: 'threads' }
  | { slug: string; kind: 'thread'; id: string }
  | { slug: string; kind: 'replies'; id: string }
  | { slug: string; kind: 'comment'; id: string }

export function commentsRoute(path: string): CommentsRoute | null {
  const match = /^\/api\/trips\/([^/]+)\/(threads|comments)(?:\/([A-Za-z0-9_-]{1,32})(\/comments)?)?$/.exec(path)
  if (!match?.[1]) return null
  const slug = decodeURIComponent(match[1])
  const [, , kind, id, replies] = match
  if (kind === 'threads' && !id) return { slug, kind: 'threads' }
  if (kind === 'threads' && id) return replies ? { slug, kind: 'replies', id } : { slug, kind: 'thread', id }
  if (kind === 'comments' && id && !replies) return { slug, kind: 'comment', id }
  return null
}
