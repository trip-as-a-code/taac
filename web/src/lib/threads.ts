// Where discussions can hang, and where each one leads: the anchors the pages
// mark with ThreadButton, by the same names (`item:<id>`, `day:<date>`, …).

import type { TripExport } from '@taac/core'

import type { I18n } from '@/i18n'
import type { ChangeSet } from '@/lib/changes'

export interface ThreadTarget {
  /** What it is about, as the page names it. */
  title: string
  /** The page and the spot on it. */
  href: string
}

export function threadTargets(trip: TripExport, i18n: I18n): Record<string, ThreadTarget> {
  const { t, path, date } = i18n
  const page = (section: string) => path(`/trips/${trip.slug}/${section ? `${section}/` : ''}`)
  const targets: Record<string, ThreadTarget> = { trip: { title: t('comments.general'), href: page('') } }
  for (const day of trip.days)
    targets[`day:${day.date}`] = {
      title: date(day.date, { weekday: 'long', day: 'numeric', month: 'long' }),
      href: `${page('itinerary')}#${day.date}`,
    }
  for (const item of trip.items)
    targets[`item:${item.id}`] = { title: item.title, href: `${page('itinerary')}#item-${item.id}` }
  for (const pass of trip.passes)
    targets[`pass:${pass.id}`] = { title: pass.title, href: `${page('bookings')}#pass-${pass.id}` }
  for (const idea of trip.ideas)
    targets[`idea:${idea.id}`] = { title: idea.title, href: `${page('ideas')}#idea-${idea.id}` }
  for (const task of trip.tasks)
    targets[`task:${task.id}`] = { title: task.title, href: `${page('tasks')}#task-${task.id}` }
  for (const category of trip.packing)
    for (const item of category.items)
      targets[`packing:${item.id}`] = { title: item.name, href: `${page('packing')}#packing-${item.id}` }
  return targets
}

/**
 * Where things renamed lately went: ids come from titles, so a rename gives a
 * thing a new anchor. Each old anchor leads to its current one, through any
 * number of renames; one that something else uses now stays.
 */
export function movedAnchors(sets: ChangeSet[], targets: Record<string, ThreadTarget>): Record<string, string> {
  const next = new Map<string, string>()
  for (const set of sets.toSorted((a, b) => a.date.localeCompare(b.date)))
    for (const [from, to] of set.moves ?? []) if (from !== to) next.set(from, to)
  const moved: Record<string, string> = {}
  for (const from of next.keys()) {
    if (targets[from]) continue
    let to = from
    const seen = new Set([from])
    while (next.has(to) && !seen.has(next.get(to)!)) seen.add((to = next.get(to)!))
    if (to !== from && targets[to]) moved[from] = to
  }
  return moved
}
