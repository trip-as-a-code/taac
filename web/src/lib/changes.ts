// What changed in a trip from one version of its files to the next, in the
// terms people use: added, moved, booked, repriced. The build replays the
// git history through the loader and diffs consecutive versions.

import type { Item, TripExport } from '@taac/core'

export type ChangeKind =
  | 'added'
  | 'removed'
  | 'renamed'
  | 'moved'
  | 'booked'
  | 'cancelled'
  | 'unbooked'
  | 'price'
  | 'who'
  | 'ideaAdded'
  | 'ideaRemoved'

export interface ChangeEvent {
  kind: ChangeKind
  /** The plan or idea as it is now (as it was, when removed). */
  id: string
  title: string
  from?: string
  to?: string
}

export interface ChangeSet {
  sha: string
  /** ISO date-time of the commit. */
  date: string
  author: string
  /** The author's GitHub login, lowercase, when GitHub knows it. */
  login?: string
  pr?: number
  events: ChangeEvent[]
}

const when = (i: Item) => [i.local.date, i.local.time].filter(Boolean).join(' ')
const price = (i: Item) => {
  const sums = new Map<string, number>()
  for (const c of [...i.costs, ...(i.bookings ?? []).flatMap((b) => b.costs)])
    sums.set(c.currency, (sums.get(c.currency) ?? 0) + c.amount)
  return [...sums].map(([currency, amount]) => `${Math.round(amount * 100) / 100} ${currency}`).join(' + ')
}
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Events turning `before` into `after`, plans first in plan order, then ideas. */
export function diffTrips(before: TripExport, after: TripExport): ChangeEvent[] {
  const events: ChangeEvent[] = []
  const old = new Map(before.items.map((i) => [i.id, i]))
  const now = new Map(after.items.map((i) => [i.id, i]))
  const added = after.items.filter((i) => !old.has(i.id))
  const removed = before.items.filter((i) => !now.has(i.id))
  // A new title on the same day for the same kind of plan is a rename, not a swap.
  const renamed = new Map<string, Item>()
  for (const a of added) {
    const r = removed.find((x) => !renamed.has(x.id) && x.kind === a.kind && x.local.date === a.local.date)
    if (r) renamed.set(r.id, a)
  }
  const renamedTo = new Set([...renamed.values()].map((i) => i.id))

  for (const item of after.items) {
    const was = old.get(item.id) ?? [...renamed].find(([, to]) => to.id === item.id)?.[0]
    const prev = typeof was === 'string' ? old.get(was) : was
    if (!prev) {
      events.push({ kind: 'added', id: item.id, title: item.title })
      continue
    }
    const base = { id: item.id, title: item.title }
    if (renamedTo.has(item.id)) events.push({ ...base, kind: 'renamed', from: prev.title, to: item.title })
    if (when(prev) !== when(item)) events.push({ ...base, kind: 'moved', from: when(prev), to: when(item) })
    if (prev.booking.status !== item.booking.status) {
      const kind =
        item.booking.status === 'booked' ? 'booked' : item.booking.status === 'cancelled' ? 'cancelled' : 'unbooked'
      events.push({ ...base, kind })
    }
    if (price(prev) !== price(item)) events.push({ ...base, kind: 'price', from: price(prev), to: price(item) })
    if (!same(prev.members, item.members)) events.push({ ...base, kind: 'who' })
  }
  for (const item of removed.filter((i) => !renamed.has(i.id)))
    events.push({ kind: 'removed', id: item.id, title: item.title })

  const ideas = new Set(before.ideas.map((i) => i.id))
  const kept = new Set(after.ideas.map((i) => i.id))
  for (const idea of after.ideas.filter((i) => !ideas.has(i.id)))
    events.push({ kind: 'ideaAdded', id: idea.id, title: idea.title })
  for (const idea of before.ideas.filter((i) => !kept.has(i.id)))
    events.push({ kind: 'ideaRemoved', id: idea.id, title: idea.title })
  return events
}
