// What the filters can ask about a plan or an idea, computed at build time
// and shipped as `data-facts` (or in the map's data). scripts/filters.ts
// matches them against the viewer's filters.

import type { Idea, Item, TripExport } from '@taac/core'

export interface Facts {
  kind: string
  /** Booking status; ideas without a booking have none. */
  status?: string
  priority?: 'must' | 'maybe'
  /** First and last local day; ideas have none. */
  day?: string
  end?: string
  deadline?: string
  /** `open` when a blocker clash is not overridden, else `overridden`. */
  conflict?: 'open' | 'overridden'
  priced: boolean
  payers: string[]
  places: string[]
  tags: string[]
  /** Folded search text: title, places, notes, provider, carrier, tags. */
  text: string
}

/** Lowercase, without diacritics, so `kyoto` finds `Kyōto`. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function payers(costs: Item['costs']): string[] {
  return [...new Set(costs.flatMap((c) => (c.paidBy.length ? c.paidBy : c.who)))]
}

function text(trip: TripExport, parts: (string | undefined)[], places: string[]): string {
  return fold([...parts, ...places.map((p) => trip.places[p]?.name)].filter(Boolean).join(' '))
}

export function itemFacts(trip: TripExport, item: Item): Facts {
  const clashes = item.conflicts
  return {
    kind: item.kind,
    status: item.booking.status,
    day: item.local.date,
    end: item.local.endDate ?? item.local.date,
    deadline: item.booking.deadline,
    conflict: clashes.length ? (clashes.some((c) => !c.overridden) ? 'open' : 'overridden') : undefined,
    priced: item.costs.some((c) => c.amount > 0),
    payers: payers(item.costs),
    places: item.places,
    tags: item.tags,
    text: text(
      trip,
      [item.title, item.notes, item.booking.provider, item.transport?.carrier, item.transport?.number, ...item.tags],
      item.places,
    ),
  }
}

export function ideaFacts(trip: TripExport, idea: Idea): Facts {
  const places = idea.area ? [idea.area, ...idea.places.filter((p) => p !== idea.area)] : idea.places
  return {
    kind: idea.kind,
    status: idea.booking?.status,
    priority: idea.priority,
    deadline: idea.booking?.deadline,
    priced: idea.costs.some((c) => c.amount > 0),
    payers: payers(idea.costs),
    places,
    tags: idea.tags,
    text: text(trip, [idea.title, idea.notes, ...idea.tags], places),
  }
}
