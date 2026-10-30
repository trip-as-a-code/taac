// Who is on the trip when, and in which UTC offset, from what the plans say.

import type { TripExport } from '@taac/core'

import { issuesOf } from '@/lib/facts'

export const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

const TRANSPORT = new Set(['flight', 'train', 'bus', 'ferry', 'transfer', 'walk', 'ride'])
export const isTransport = (kind: string) => TRANSPORT.has(kind)

const cache = new WeakMap<TripExport, Map<string, { first: string; last: string }>>()

/** Each member's first and last day: bases, and the plans that name them (an unassigned plan says nothing). */
export function spans(trip: TripExport): Map<string, { first: string; last: string }> {
  let out = cache.get(trip)
  if (out) return out
  out = new Map()
  const extend = (member: string, from: string, to: string) => {
    const span = out!.get(member)
    out!.set(member, {
      first: span && span.first < from ? span.first : from,
      last: span && span.last > to ? span.last : to,
    })
  }
  for (const base of trip.bases) for (const m of base.members) extend(m, base.from, nextDay(base.to))
  for (const item of trip.items)
    if (!issuesOf(trip, item.id).some((d) => d.code === 'item.unassigned'))
      for (const m of item.members) extend(m, item.local.date, item.local.endDate ?? item.local.date)
  cache.set(trip, out)
  return out
}

/** The UTC offset (`+02:00`) a member is in on a day: where their latest plan up to then put them. */
export function offsetOn(trip: TripExport, member: string, date: string): string | undefined {
  let best: { date: string; end: boolean; offset: string } | undefined
  const consider = (d: string, end: boolean, offset?: string) => {
    if (!offset || d > date) return
    if (!best || d > best.date || (d === best.date && end && !best.end)) best = { date: d, end, offset }
  }
  for (const item of trip.items) {
    if (!item.members.includes(member)) continue
    consider(item.local.date, false, item.local.offset)
    consider(item.local.endDate ?? item.local.date, true, item.local.endOffset ?? item.local.offset)
  }
  return best?.offset
}

/** The trip's own UTC offset on a day (`+09:00`). */
export function tripOffset(trip: TripExport, date: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: trip.timezone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value
  const m = /GMT([+-]\d{2}:\d{2})/.exec(name ?? '')
  return m ? m[1]! : '+00:00'
}

const minutes = (offset: string) => {
  const [h, m] = offset.slice(1).split(':').map(Number) as [number, number]
  return (offset.startsWith('-') ? -1 : 1) * (h * 60 + m)
}

/** `HH:MM` in one offset → the same instant's wall time in another. */
export function shiftTime(time: string, from: string, to: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const total = (((h * 60 + m + minutes(to) - minutes(from)) % 1440) + 1440) % 1440
  const out = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  // A window running to midnight ends at 24:00, not 00:00.
  return out === '00:00' && time !== '00:00' ? '24:00' : out
}
