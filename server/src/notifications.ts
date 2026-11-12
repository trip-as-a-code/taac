/**
 * The notification center: what happened on the trips someone is on, by
 * others, newest first: in discussions (a thread started, a reply, a thread
 * resolved) and in the plan itself (a change set, as "Recent changes" shows
 * it); and what is due for them (a task, a booking, a payment), once per
 * thing, as of its latest reminder. Each kind can be turned off per account. A notification is read when it is older than
 * the account's "read up to" (mark all as read), unless marked otherwise one
 * by one.
 */

import type { Thread } from './comments'
import { currentReminder, ticked, type DeadlineFile, type Reader } from './reminders'

export interface NotificationStore {
  /** Epoch milliseconds read up to, or 0. */
  notificationsSeen(login: string): Promise<number>
  /** Everything up to `at` is read; marks one by one are forgotten. */
  markNotificationsSeen(login: string, at: number): Promise<void>
  /** Notifications marked read (true) or unread (false) one by one. */
  notificationMarks(login: string): Promise<Map<string, boolean>>
  markNotifications(login: string, ids: string[], read: boolean): Promise<void>
}

export function isRead(n: Pick<Notification, 'id' | 'at'>, seenAt: number, marks: Map<string, boolean>): boolean {
  return marks.get(n.id) ?? n.at <= seenAt
}

export const KINDS = ['thread', 'reply', 'resolved', 'change', 'booking', 'payment', 'task'] as const
export type Kind = (typeof KINDS)[number]

export interface Notification {
  id: string
  trip: string
  kind: Kind
  /** Where it happened (a thread's anchor) and in which thread. */
  anchor: string
  thread: string
  /** Lowercase GitHub login of whoever did it; empty when only a name is known. */
  by: string
  /** Their name when there is no login (a commit made outside GitHub). */
  author?: string
  /** The comment's text, if it was one. */
  text: string
  at: number
  /** What is due: its date. */
  due?: string
  /** Days from the deadline of its latest reminder: before it (positive) or after (negative). */
  rung?: number
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

/** A change set as the build wrote it (`trips/<slug>/changes.json`). */
export interface ChangeSet {
  id: string
  login?: string
  author: string
  at: number
  summary: string
  href: string
}

/** Others' changes to a trip's plan. */
export function changeEvents(trip: string, sets: ChangeSet[], login: string): Notification[] {
  return sets
    .filter((set) => set.login !== login)
    .map((set) => ({
      id: `change:${set.id}`,
      trip,
      kind: 'change' as const,
      anchor: 'changes',
      thread: '',
      by: set.login ?? '',
      author: set.login ? undefined : set.author || undefined,
      text: set.summary,
      at: set.at,
    }))
}

/**
 * What is due for someone: each thing once, from its first reminder on, as of
 * its latest one, which makes it unread again.
 */
/** A deadline's reminder in the list: one per rung, so a later one is new again. */
export const dueId = (d: { key: string; date: string }, rung: number) => `due:${d.key}:${d.date}:${rung}`

export function deadlineEvents(
  trip: string,
  file: DeadlineFile,
  login: string,
  now: number,
  reader: Reader,
  ticks: Record<string, { packed: boolean }> = {},
): Notification[] {
  return file.deadlines.flatMap((d) => {
    // A task ticked done on the site no longer reminds.
    if (!d.logins.includes(login) || ticked(d, login, ticks)) return []
    const reminder = currentReminder(d, now, file.timezone, reader)
    if (!reminder) return []
    return [
      {
        id: dueId(d, reminder.rung),
        trip,
        kind: d.kind,
        anchor: d.anchor,
        thread: '',
        by: '',
        text: '',
        at: reminder.at,
        due: d.date,
        rung: reminder.rung,
      },
    ]
  })
}

/** A page of them, newest first: `limit` from before `before` (epoch ms), if given. */
export function page(events: Notification[], limit: number, before?: number): Notification[] {
  return events
    .filter((e) => before === undefined || e.at < before)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
}
