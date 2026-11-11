// The trip as it is today: where you sleep tonight, what is on now and
// next, and tomorrow's first plan. The site is static, so the page carries
// every day and this picks one by the date where the trip is.

export interface TodayPlace {
  name: string
  address?: string
  geo: [number, number]
}

export interface TodayItem {
  id: string
  title: string
  kind: string
  /** Local wall time, `HH:MM`. */
  time?: string
  /** When it ends, local, on the same day. */
  endTime?: string
  part?: string
  /** Absolute instants, for "now" and countdowns. */
  start?: string
  end?: string
  place?: TodayPlace
  members: string[]
  href: string
}

export interface TodayStay {
  title: string
  place?: TodayPlace
  members: string[]
  /** Check-out day, when it isn't tomorrow. */
  until?: string
  href: string
}

export interface TodayDay {
  n: number
  date: string
  items: TodayItem[]
  stays: TodayStay[]
  present: string[]
}

export interface TodayData {
  timezone: string
  /** Members' names by id, to say whose stay is whose when the group splits. */
  names: Record<string, string>
  days: TodayDay[]
}

export interface TodayView {
  day: TodayDay
  now: TodayItem[]
  next: TodayItem[]
  done: number
  stays: TodayStay[]
  tomorrow?: TodayItem
}

/** The trip's local date (`YYYY-MM-DD`) at `now`. */
export function tripDate(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
}

const mine = (members: string[], people: string[]) => !people.length || members.some((m) => people.includes(m))

/**
 * What today holds for `people` (everyone when empty). Without `now` (a
 * preview of another day) nothing has started or ended yet.
 */
export function todayView(data: TodayData, date: string, people: string[], now?: number): TodayView | undefined {
  const index = data.days.findIndex((d) => d.date === date)
  if (index < 0) return undefined
  const day = data.days[index]
  const items = day.items.filter((i) => mine(i.members, people))
  const started = (i: TodayItem) => now !== undefined && i.start !== undefined && Date.parse(i.start) <= now
  const ended = (i: TodayItem) =>
    now !== undefined && Date.parse(i.end ?? i.start ?? '') + (i.end ? 0 : 60 * 60_000) <= now
  const current = items.filter((i) => started(i) && !ended(i))
  const upcoming = items.filter((i) => !started(i))
  const tomorrow = data.days[index + 1]?.items.find((i) => mine(i.members, people))
  return {
    day,
    now: current,
    next: upcoming,
    done: items.length - current.length - upcoming.length,
    stays: day.stays.filter((s) => mine(s.members, people)),
    tomorrow,
  }
}

/** Opens directions in whatever maps app the device prefers for the web link. */
export const mapsHref = ([lat, lon]: [number, number]) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
