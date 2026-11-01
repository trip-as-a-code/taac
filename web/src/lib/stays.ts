// Where the trip sleeps, day by day, as runs of days in one place: the
// itinerary's day strip groups its days by them. Every day has a place: a
// stay, a night on the way (an overnight journey), or home before the first
// stay and after the last. Shared by the build and the page, which regroups
// when the people lens changes.

import type { TripExport } from '@taac/core'

import { areasAround } from './geo'
import { isTransport } from './presence'

export interface DayStay {
  date: string
  /** Where each of its people spends that night. */
  bases: { title: string; members: string[] }[]
}

export interface StayRun {
  /** The places, most people first; empty when nobody's place is known. */
  titles: string[]
  /** Who of the people in view is in each of them. */
  who: string[][]
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
  // Where each member spent the night before.
  const previous = new Map<string, string>()
  return trip.days.map((day) => {
    const places: DayStay['bases'] = day.bases.map((b) => ({
      title: titles.get(b.id) ?? b.id,
      members: b.members,
    }))
    const add = (title: string, member: string) => {
      const entry = places.find((p) => p.title === title)
      if (entry) entry.members.push(member)
      else places.push({ title, members: [member] })
      previous.set(member, title)
    }
    for (const member of trip.members) {
      const base = places.find((p) => p.members.includes(member.id))
      if (base) {
        previous.set(member.id, base.title)
        continue
      }
      const journey = trip.items.find(
        (i) =>
          isTransport(i.kind) &&
          i.members.includes(member.id) &&
          i.local.date <= day.date &&
          day.date < (i.local.endDate ?? i.local.date),
      )
      if (journey) {
        // The day is spent where the journey starts: the town left, not its airport.
        add(previous.get(member.id) ?? placeName(trip, journey.places[0]), member.id)
        continue
      }
      const home = member.home ?? trip.home
      const { first, last } = stays.get(member.id)!
      if (home && ((first && day.date < first) || (last && day.date > last))) add(placeName(trip, home), member.id)
    }
    return { date: day.date, bases: places }
  })
}

/** The places `people` (everyone when empty) sleep in that night, and who. */
export function placesOf(day: DayStay, people: string[]): { title: string; members: string[] }[] {
  const seen = new Map<string, string[]>()
  for (const base of day.bases) {
    const who = people.length ? base.members.filter((m) => people.includes(m)) : base.members
    if (!who.length) continue
    seen.set(base.title, [...new Set([...(seen.get(base.title) ?? []), ...who])])
  }
  return [...seen]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([title, members]) => ({ title, members }))
}

/** Consecutive days with the same places, in order. */
export function stayRuns(days: DayStay[], people: string[]): StayRun[] {
  const runs: StayRun[] = []
  for (const day of days) {
    const places = placesOf(day, people)
    const key = JSON.stringify(places)
    const last = runs.at(-1)
    if (last && JSON.stringify(last.titles.map((title, i) => ({ title, members: last.who[i] }))) === key)
      last.dates.push(day.date)
    else runs.push({ titles: places.map((p) => p.title), who: places.map((p) => p.members), dates: [day.date] })
  }
  return runs
}

/** A steady hue per place, so a city keeps its colour wherever it shows. */
export function placeHue(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

/** The stay's places in words; a split one says who is where. */
export function stayTitle(run: StayRun, nameOf: (id: string) => string): string {
  if (run.titles.length < 2) return run.titles[0] ?? ''
  return run.titles.map((title, i) => `${title}: ${run.who[i]!.map(nameOf).join(', ')}`).join(' · ')
}

/** A split stay's chip bar: each place's colour, as wide as its share of the people. */
export function splitBar(run: StayRun): string {
  const total = run.who.reduce((sum, w) => sum + w.length, 0)
  let at = 0
  const stops = run.titles.map((title, i) => {
    const from = (at / total) * 100
    at += run.who[i]!.length
    return `hsl(${placeHue(title)} 70% 55%) ${from}% ${(at / total) * 100}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}
