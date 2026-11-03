/**
 * Reminders of what is due: tasks, bookings to make and payments to come, as
 * the build lists them (`trips/<slug>/deadlines.json`). Each deadline is a
 * date that ends at midnight where the trip is (a Japanese site closes at
 * 23:59 Tokyo time), and reminds its people on a ladder of days, more often
 * the closer it gets, at their own reminder time (09:00 unless they chose
 * another) where they are. Missed, it keeps reminding for a while.
 */

export type DeadlineKind = 'booking' | 'payment' | 'task'

/** One thing due, as the build wrote it. */
export interface Deadline {
  /** Stable within the trip, such as `booking:item:<id>` or `task:<id>`. */
  key: string
  kind: DeadlineKind
  /** Where it is, as discussions name it (`item:<id>`, `task:<id>`, …): its title and page. */
  anchor: string
  date: string
  /** Lowercase GitHub logins of the people it is for. */
  logins: string[]
  /** No reminders after this day, once it no longer matters; the deadline itself if absent. */
  until?: string
  /** `light`: an idea's booking, only if it is chosen; `payment`: money charged later. */
  ladder: 'full' | 'light' | 'payment'
}

export interface DeadlineFile {
  /** The trip's time zone: where its deadlines end. */
  timezone: string
  deadlines: Deadline[]
}

export const DEFAULT_REMIND_AT = '09:00'

/** Days before the deadline (positive) and after it (negative) that remind, for each ladder. */
const BEFORE: Record<Deadline['ladder'], number[]> = {
  full: [30, 14, 7, 3, 2, 1, 0],
  light: [7, 1],
  payment: [7, 3, 1, 0],
}
const AFTER: Record<Deadline['ladder'], number[]> = { full: [1, 3, 5, 7], light: [], payment: [1, 7] }

const DAY = 86_400_000

/** `2026-11-25` plus `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

/** How far ahead of UTC a time zone is at an instant, in milliseconds. */
function offsetOf(at: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const wall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return wall - Math.floor(at / 1000) * 1000
}

/** The instant a wall clock in a time zone shows `time` on `date`. */
export function zonedTime(date: string, time: string, timeZone: string): number {
  const [h, m] = time.split(':').map(Number)
  const wall = Date.parse(`${date}T00:00:00Z`) + (h! * 60 + m!) * 60_000
  const guess = wall - offsetOf(wall, timeZone)
  // Once more, for a guess on the other side of a clock change.
  return wall - offsetOf(guess, timeZone)
}

/** The calendar day it is in a time zone. */
export function dayIn(at: number, timeZone: string): string {
  return new Date(at + offsetOf(at, timeZone)).toISOString().slice(0, 10)
}

export function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const validRemindAt = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)

/** Days before (positive) or after (negative) the deadline that remind, in order. */
export function rungs(deadline: Deadline): number[] {
  const until = deadline.until ?? deadline.date
  const after = [...AFTER[deadline.ladder]]
  // Past the first week, a full ladder keeps going weekly while it still matters.
  if (deadline.ladder === 'full') for (let n = 14; n <= daysBetween(deadline.date, until); n += 7) after.push(n)
  return [...BEFORE[deadline.ladder], ...after.filter((n) => n <= daysBetween(deadline.date, until)).map((n) => -n)]
}

export interface Reader {
  timeZone: string
  remindAt: string
}

/**
 * When a rung reminds someone: their reminder time, where they are, that many
 * days from the deadline. Before it, never after the deadline has ended where
 * the trip is: a day earlier when their morning comes too late.
 */
export function rungTime(deadline: Deadline, rung: number, tripZone: string, reader: Reader): number {
  let at = zonedTime(addDays(deadline.date, -rung), reader.remindAt, reader.timeZone)
  if (rung >= 0) {
    const ends = zonedTime(addDays(deadline.date, 1), '00:00', tripZone)
    while (at >= ends) at -= DAY
  }
  return at
}

export interface Reminder {
  rung: number
  at: number
}

/** The latest rung that has come, while the deadline still matters; null before the first or after it ends. */
export function currentReminder(deadline: Deadline, now: number, tripZone: string, reader: Reader): Reminder | null {
  if (now >= zonedTime(addDays(deadline.until ?? deadline.date, 1), '00:00', reader.timeZone)) return null
  let found: Reminder | null = null
  for (const rung of rungs(deadline)) {
    const at = rungTime(deadline, rung, tripZone, reader)
    if (at <= now) found = { rung, at }
  }
  return found
}

/**
 * Whether a rung still goes out as a push: the urgent ones (a day before and
 * later) always, earlier ones within a day of their time. A deadline added late,
 * or a server that was down, starts at the next rung instead of a burst of old ones.
 */
export const stillTimely = (reminder: Reminder, now: number) => reminder.rung <= 1 || now - reminder.at < DAY

/**
 * A deadline key (`task:<id>`, `booking:item:<id>:1`, `payment:pass:<id>:0:2`, …)
 * with the anchor `from` in it changed to `to`, or null when it isn't about `from`.
 */
export function movedKey(key: string, from: string, to: string): string | null {
  for (const prefix of ['', 'booking:', 'payment:'])
    if (key === prefix + from || key.startsWith(`${prefix}${from}:`))
      return prefix + to + key.slice(prefix.length + from.length)
  return null
}

/** A deadline notification's id (`due:<key>:<date>:<rung>`) moved the same way, or null. */
export function movedDueId(id: string, from: string, to: string): string | null {
  const match = /^due:(.+)(:\d{4}-\d{2}-\d{2}:-?\d+)$/.exec(id)
  const key = match && movedKey(match[1]!, from, to)
  return key ? `due:${key}${match[2]}` : null
}
