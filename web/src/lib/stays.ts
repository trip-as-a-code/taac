// Where the trip sleeps, day by day, as runs of days in one place: the
// itinerary's day strip groups its days by them. Every day has a place: a
// stay, a night on the way (an overnight journey), or home before the first
// stay and after the last. Shared by the build and the page, which regroups
// when the people lens changes.

import type { TripExport } from '@taac/core'

import { areasAround } from './geo'
import { isTransport } from './presence'

export type StayKind = 'base' | 'transit' | 'home'

export interface DayStay {
  date: string
  /** Where each of its people spends that night. */
  bases: { title: string; members: string[]; kind?: StayKind }[]
}

export interface StayRun {
  /** The places, most people first; empty when nobody's place is known. */
  titles: string[]
  /** Every place is a night on the way. */
  transit: boolean
  dates: string[]
}

/** A place by its area's name (the city around an airport), else its own. */
function placeName(trip: TripExport, id: string | undefined): string {
  if (!id) return ''
  const area = areasAround(trip, [id]).find((a) => a !== id)
  return trip.places[area ?? id]?.name ?? id
}

/** Every day's places for everyone on the trip. */
export function nightsOf(trip: TripExport): DayStay[] {
  const titles = new Map(trip.bases.map((b) => [b.id, b.title]))
  const stays = new Map(
    trip.members.map((m) => {
      const mine = trip.bases.filter((b) => b.members.includes(m.id))
      return [
        m.id,
        {
          first: mine.map((b) => b.from).sort()[0],
          last: mine
            .map((b) => b.to)
            .sort()
            .at(-1),
        },
      ]
    }),
  )
  return trip.days.map((day) => {
    const places: DayStay['bases'] = day.bases.map((b) => ({
      title: titles.get(b.id) ?? b.id,
      members: b.members,
      kind: 'base',
    }))
    const add = (title: string, member: string, kind: StayKind) => {
      const entry = places.find((p) => p.title === title && p.kind === kind)
      if (entry) entry.members.push(member)
      else places.push({ title, members: [member], kind })
    }
    for (const member of trip.members) {
      if (day.bases.some((b) => b.members.includes(member.id))) continue
      const journey = trip.items.find(
        (i) =>
          isTransport(i.kind) &&
          i.members.includes(member.id) &&
          i.local.date <= day.date &&
          day.date < (i.local.endDate ?? i.local.date),
      )
      if (journey) {
        add(`${placeName(trip, journey.places[0])} → ${placeName(trip, journey.places.at(-1))}`, member.id, 'transit')
        continue
      }
      const home = member.home ?? trip.home
      const { first, last } = stays.get(member.id)!
      if (home && ((first && day.date < first) || (last && day.date > last)))
        add(placeName(trip, home), member.id, 'home')
    }
    return { date: day.date, bases: places }
  })
}

/** The places `people` (everyone when empty) sleep in that night. */
export function placesOf(day: DayStay, people: string[]): { title: string; kind: StayKind }[] {
  const seen = new Map<string, { count: number; kind: StayKind }>()
  for (const base of day.bases) {
    const who = people.length ? base.members.filter((m) => people.includes(m)) : base.members
    if (!who.length) continue
    const entry = seen.get(base.title) ?? { count: 0, kind: base.kind ?? 'base' }
    entry.count += who.length
    seen.set(base.title, entry)
  }
  return [...seen]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([title, { kind }]) => ({ title, kind }))
}

/** Consecutive days with the same places, in order. */
export function stayRuns(days: DayStay[], people: string[]): StayRun[] {
  const runs: StayRun[] = []
  for (const day of days) {
    const places = placesOf(day, people)
    const titles = places.map((p) => p.title)
    const last = runs.at(-1)
    if (last && last.titles.join('\u0000') === titles.join('\u0000')) last.dates.push(day.date)
    else
      runs.push({ titles, transit: places.length > 0 && places.every((p) => p.kind === 'transit'), dates: [day.date] })
  }
  return runs
}

/** A steady hue per place, so a city keeps its colour wherever it shows. */
export function placeHue(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}
