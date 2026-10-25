// What the filters can ask about a plan or an idea, computed at build time
// and shipped as `data-facts` (or in the map's data). scripts/filters.ts
// matches them against the viewer's filters.

import type { Diagnostic, Idea, Item, TripExport } from '@taac/core'

export interface Facts {
  kind: string
  /** Booking status; an idea's is at most `required`. */
  status?: string
  /** Every reservation's status, when a plan has several. */
  statuses?: string[]
  priority?: 'must' | 'maybe'
  /** First and last local day; ideas have none. */
  day?: string
  end?: string
  deadline?: string
  /** `open` when a blocker clash is not overridden, else `overridden`. */
  conflict?: 'open' | 'overridden'
  priced: boolean
  /** Has a priced cost nobody has paid yet. */
  toPay: boolean
  payers: string[]
  places: string[]
  tags: string[]
  /** Diagnostic codes the validator raised for it. */
  issues: string[]
  /** No `who`: kept out of every people selection. */
  unassigned: boolean
  /** Folded search text: title, places, notes, provider, carrier, tags. */
  text: string
}

/** Lowercase, without diacritics, so `kyoto` finds `Kyōto`. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Issues with their own short label; the rest read "worth a look". */
export const ISSUE_CODES = [
  'blocker.conflict',
  'item.unassigned',
  'item.absent',
  'item.overlap',
  'item.unlocated',
  'item.route',
  'booking.cost',
  'booking.reference',
  'booking.deadline',
  'cost.estimate',
] as const
export type IssueCode = (typeof ISSUE_CODES)[number]

export function isLabelled(code: string): code is IssueCode {
  return (ISSUE_CODES as readonly string[]).includes(code)
}

/** Kinds of issue, for the filter: what to go and fix. */
export type IssueGroup = 'people' | 'clash' | 'booking' | 'place' | 'other'

export function issueGroup(code: string): IssueGroup {
  if (code.startsWith('who.') || code === 'item.unassigned' || code === 'item.absent') return 'people'
  if (code === 'blocker.conflict' || code === 'item.overlap') return 'clash'
  if (code.startsWith('booking.') || code.startsWith('cost.')) return 'booking'
  if (
    code.startsWith('place.') ||
    ['item.place', 'item.route', 'item.unlocated', 'idea.place', 'idea.area'].includes(code)
  )
    return 'place'
  return 'other'
}

const byItem = new WeakMap<TripExport, Map<string, Diagnostic[]>>()

/** What the validator said about one plan or idea. */
export function issuesOf(trip: TripExport, id: string): Diagnostic[] {
  if (!byItem.has(trip))
    byItem.set(
      trip,
      Map.groupBy(
        trip.diagnostics.filter((d) => d.item),
        (d) => d.item!,
      ),
    )
  return byItem.get(trip)!.get(id) ?? []
}

function payers(costs: Item['costs']): string[] {
  return [...new Set(costs.flatMap((c) => (c.unpaid ? [] : c.each ? c.who : c.paidBy)))]
}

function text(trip: TripExport, parts: (string | undefined)[], places: string[]): string {
  return fold([...parts, ...places.map((p) => trip.places[p]?.name)].filter(Boolean).join(' '))
}

export function itemFacts(trip: TripExport, item: Item): Facts {
  const clashes = item.conflicts
  return {
    kind: item.kind,
    status: item.booking.status,
    statuses: item.bookings?.map((b) => b.status),
    day: item.local.date,
    end: item.local.endDate ?? item.local.date,
    deadline: item.booking.deadline,
    conflict: clashes.length ? (clashes.some((c) => !c.overridden) ? 'open' : 'overridden') : undefined,
    priced: item.costs.some((c) => c.amount > 0),
    toPay: item.costs.some((c) => c.amount > 0 && c.unpaid),
    payers: payers(item.costs),
    places: item.places,
    tags: item.tags,
    issues: issuesOf(trip, item.id).map((d) => d.code),
    unassigned: issuesOf(trip, item.id).some((d) => d.code === 'item.unassigned'),
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
    day: idea.local?.date,
    end: idea.local?.endDate ?? idea.local?.date,
    deadline: idea.booking?.deadline,
    priced: idea.costs.some((c) => c.amount > 0),
    // Possible spend: nothing to pay until it becomes a plan.
    toPay: false,
    payers: [],
    places,
    tags: idea.tags,
    issues: issuesOf(trip, idea.id).map((d) => d.code),
    unassigned: issuesOf(trip, idea.id).some((d) => d.code === 'item.unassigned'),
    text: text(trip, [idea.title, idea.notes, ...idea.tags], places),
  }
}
