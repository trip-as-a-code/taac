/**
 * The notification center: what happened on the trips someone is on, by
 * others, newest first. Discussions are the first source: a thread started,
 * a reply, a thread resolved. Read state is one "seen up to" per account.
 */

import type { Thread } from './comments'

export interface NotificationStore {
  /** Epoch milliseconds read up to, or 0. */
  notificationsSeen(login: string): Promise<number>
  markNotificationsSeen(login: string, at: number): Promise<void>
}

export interface Notification {
  id: string
  trip: string
  kind: 'thread' | 'reply' | 'resolved'
  /** Where it happened (a thread's anchor) and in which thread. */
  anchor: string
  thread: string
  /** Lowercase GitHub login of whoever did it. */
  by: string
  /** The comment's text, if it was one. */
  text: string
  at: number
}

export const NOTIFICATION_LIMIT = 50

/** What others did in a trip's discussions, ever. */
export function discussionEvents(trip: string, threads: Thread[], login: string): Notification[] {
  const events: Notification[] = []
  for (const thread of threads) {
    thread.comments.forEach((comment, index) => {
      if (comment.author === login || comment.deletedAt !== null) return
      events.push({
        id: `comment:${comment.id}`,
        trip,
        kind: index === 0 ? 'thread' : 'reply',
        anchor: thread.anchor,
        thread: thread.id,
        by: comment.author,
        text: comment.body,
        at: comment.createdAt,
      })
    })
    if (thread.resolvedAt !== null && thread.resolvedBy && thread.resolvedBy !== login)
      events.push({
        id: `resolved:${thread.id}:${thread.resolvedAt}`,
        trip,
        kind: 'resolved',
        anchor: thread.anchor,
        thread: thread.id,
        by: thread.resolvedBy,
        text: '',
        at: thread.resolvedAt,
      })
  }
  return events
}

/** A page of them, newest first: `limit` from before `before` (epoch ms), if given. */
export function page(events: Notification[], limit: number, before?: number): Notification[] {
  return events
    .filter((e) => before === undefined || e.at < before)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}
