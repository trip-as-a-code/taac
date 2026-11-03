import type { Base, BookingStatus, Idea, Item, ItemKind, Member, Pass, TripExport } from '@taac/core'
import { marked } from 'marked'

import { issuesOf } from '@/lib/facts'
import { distanceM } from '@/lib/geo'

import type { IconName } from '@/components/Icon.astro'

/** Budget categories: every item kind, plus passes and things bought before packing. */
export type CostKind = ItemKind | 'pass' | 'packing' | 'spending'

export const kindIcon: Record<CostKind, IconName> = {
  flight: 'flight',
  train: 'train',
  bus: 'bus',
  ferry: 'ferry',
  transfer: 'transfer',
  walk: 'walk',
  ride: 'ride',
  lodging: 'lodging',
  activity: 'activity',
  meal: 'meal',
  note: 'note',
  pass: 'pass',
  packing: 'packing',
  spending: 'wallet',
}

/** CSS custom property per kind, defined in tokens. */
export const kindTint: Record<CostKind, string> = {
  flight: 'var(--blue)',
  train: 'var(--teal)',
  bus: 'var(--teal)',
  ferry: 'var(--teal)',
  transfer: 'var(--indigo)',
  walk: 'var(--green)',
  ride: 'var(--green)',
  lodging: 'var(--purple)',
  activity: 'var(--orange)',
  meal: 'var(--pink)',
  note: 'var(--gray)',
  pass: 'var(--teal)',
  packing: 'var(--yellow)',
  spending: 'var(--indigo)',
}

/** What a spending budget sets money aside for, and what's left of it. */
export type SpendingCategory =
  'groceries' | 'dining' | 'snacks' | 'souvenirs' | 'shopping' | 'transit' | 'fun' | 'other' | 'unallocated'

export const spendingIcon: Record<SpendingCategory, IconName> = {
  groceries: 'cart',
  dining: 'meal',
  snacks: 'cup',
  souvenirs: 'gift',
  shopping: 'bag',
  transit: 'taxi',
  fun: 'sparkle',
  other: 'wallet',
  unallocated: 'wallet',
}

export const spendingTint: Record<SpendingCategory, string> = {
  groceries: 'var(--green)',
  dining: 'var(--pink)',
  snacks: 'var(--orange)',
  souvenirs: 'var(--purple)',
  shopping: 'var(--blue)',
  transit: 'var(--teal)',
  fun: 'var(--yellow)',
  other: 'var(--indigo)',
  unallocated: 'var(--gray)',
}

export const statusTone: Record<BookingStatus, string | undefined> = {
  required: 'orange',
  booked: 'green',
  notRequired: undefined,
}

/** Category → emoji used on map markers. */
export function placeEmoji(category?: string): string {
  const table: Record<string, string> = {
    airport: '✈️',
    station: '🚉',
    stop: '🚏',
    port: '⛴️',
    hotel: '🛏️',
    ryokan: '♨️',
    onsen: '♨️',
    temple: '🛕',
    zen_temple: '🪷',
    shrine: '⛩️',
    garden: '🌿',
    nature: '🏔️',
    museum: '🏛️',
    shopping: '🛍️',
    food: '🍜',
    historic: '🏯',
    attraction: '✨',
    viewpoint: '🌄',
  }
  return (category && table[category]) || '📍'
}

/** Stable hue per member id for avatars. */
export function memberHue(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

export function initials(member: Member): string {
  return (member.emoji ?? member.name.slice(0, 1)).toUpperCase()
}

export function tripHue(trip: TripExport): number {
  return trip.cover?.hue ?? memberHue(trip.slug)
}

export function itemById(trip: TripExport): Map<string, Item> {
  return new Map(trip.items.map((item) => [item.id, item]))
}

export function memberName(trip: TripExport, id: string): string {
  return trip.members.find((m) => m.id === id)?.name ?? id
}

export function dayCount(trip: TripExport): number {
  return trip.days.length
}

/** Whole days between two date-only ISO strings. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export function bookable(trip: TripExport): Item[] {
  return trip.items.filter((i) => i.booking.status === 'required' || i.booking.status === 'booked')
}

const renderer = new marked.Renderer()
// Trips are written by collaborators: render Markdown, never raw HTML.
renderer.html = ({ text }) => escapeHtml(text)
renderer.link = ({ href, text }) =>
  /^(https?:|mailto:)/i.test(href)
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
    : text

export function markdown(source: string): string {
  return marked.parse(source, { renderer, async: false, gfm: true, breaks: true })
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** `data-people` value: the member ids taking part, for the people lens. */
export function people(members: string[]): string {
  return members.join(' ')
}

/** "A, B & C" from member ids. */
export function memberNames(trip: TripExport, ids: string[], and: string): string {
  const names = ids.map((id) => memberName(trip, id))
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}${and}${names.at(-1)}` : (names[0] ?? '')
}

/** A group's name, or its members' when it has none. */
export function groupLabel(trip: TripExport, group: { name?: string; members: string[] }, and: string): string {
  return group.name ?? memberNames(trip, group.members, and)
}

/** Human name of a party: everyone, a group, or "A & B". */
export function partyLabel(trip: TripExport, partyId: string, everyone: string, and: string): string {
  if (partyId === 'everyone') return everyone
  const party = trip.parties.find((p) => p.id === partyId)
  const group = party?.group ? trip.groups.find((g) => g.id === party.group) : undefined
  if (group) return groupLabel(trip, group, and)
  return memberNames(trip, party?.members ?? partyId.split('+'), and) || partyId
}

/** One colour per group on the map, in the order the trip lists them. */
const GROUP_COLORS = ['var(--green)', 'var(--pink)', 'var(--orange)', 'var(--purple)', 'var(--teal)', 'var(--yellow)']

/**
 * A party's colour on the map: everyone together in blue, a group in its own,
 * some of a group's people in that group's, anyone else in indigo.
 */
export function partyColor(trip: TripExport, partyId: string): string {
  const party = trip.parties.find((p) => p.id === partyId)
  const members = party?.members ?? partyId.split('+')
  if (partyId === 'everyone' || members.length >= trip.members.length) return 'var(--blue)'
  const index = trip.groups.findIndex((g) =>
    party?.group ? g.id === party.group : members.every((m) => g.members.includes(m)),
  )
  return index >= 0 ? GROUP_COLORS[index % GROUP_COLORS.length]! : 'var(--indigo)'
}

export function partyEmoji(trip: TripExport, partyId: string): string | undefined {
  const party = trip.parties.find((p) => p.id === partyId)
  return party?.group ? trip.groups.find((g) => g.id === party.group)?.emoji : undefined
}

export function baseById(trip: TripExport): Map<string, Base> {
  return new Map(trip.bases.map((b) => [b.id, b]))
}

/**
 * The area an idea belongs to: its own, else the smallest area (a place with
 * a radius) one of its places lies in; '' when neither says.
 */
export function ideaArea(trip: TripExport, idea: Idea): string {
  if (idea.area) return idea.area
  let best: { key: string; radius: number } | undefined
  for (const [key, area] of Object.entries(trip.places)) {
    if (!area.radius || (best && area.radius >= best.radius)) continue
    const inside = idea.places.some((id) => {
      const place = trip.places[id]
      return place && id !== key && distanceM(place.geo, area.geo) <= area.radius!
    })
    if (inside) best = { key, radius: area.radius }
  }
  return best?.key ?? ''
}

/** Ideas per area key ('' for ideas without one), in declaration order. */
export function ideasByArea(trip: TripExport): Map<string, Idea[]> {
  const out = new Map<string, Idea[]>()
  for (const idea of trip.ideas) {
    const key = ideaArea(trip, idea)
    out.set(key, [...(out.get(key) ?? []), idea])
  }
  return out
}

/** Whether a place lies in a base's area (within its radius; without one, only the place itself). */
export function inBase(trip: TripExport, base: Base, placeId: string | undefined): boolean {
  if (!placeId) return false
  if (placeId === base.place) return true
  const area = trip.places[base.place]
  const place = trip.places[placeId]
  return Boolean(area?.radius && place && distanceM(place.geo, area.geo) <= area.radius)
}

/**
 * Ideas to suggest while staying at a base: its area's, or any whose area
 * (or, without one, a place) lies inside it, for someone staying there.
 * A dated idea shows on its own day instead, never as a suggestion.
 * Must-dos first.
 */
export function ideasAt(trip: TripExport, base: Base): Idea[] {
  return trip.ideas
    .filter(
      (idea) =>
        !idea.local &&
        (idea.area ? inBase(trip, base, idea.area) : idea.places.some((p) => inBase(trip, base, p))) &&
        idea.members.some((m) => base.members.includes(m)) &&
        // Nobody chose who it's for yet: not suggested until someone does.
        !issuesOf(trip, idea.id).some((d) => d.code === 'item.unassigned'),
    )
    .sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'))
}

/**
 * Route rows: one per set of people who sleep in the same places every night,
 * however many ways the trip splits; a single unlabelled row when nobody does.
 * A row named like a group takes its name.
 */
export function routeRows(
  trip: TripExport,
  and: string,
): { label?: string; emoji?: string; members: string[]; bases: Base[] }[] {
  const ordered = [...trip.bases].sort((a, b) => a.from.localeCompare(b.from))
  const nightsOf = (member: string) =>
    trip.days.map((d) => ordered.find((b) => b.members.includes(member) && b.from <= d.date && d.date <= b.to)?.id)
  const tracks = new Map<string, string[]>()
  for (const m of trip.members) {
    const key = nightsOf(m.id).join()
    tracks.set(key, [...(tracks.get(key) ?? []), m.id])
  }
  if (tracks.size < 2) return [{ members: trip.members.map((m) => m.id), bases: ordered }]
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((m) => b.includes(m))
  return [...tracks.values()].map((members) => {
    const group = trip.groups.find((g) => same(g.members, members))
    return {
      label: group ? groupLabel(trip, group, and) : memberNames(trip, members, and),
      emoji: group?.emoji,
      members,
      bases: ordered.filter((b) => members.every((m) => b.members.includes(m))),
    }
  })
}

/** The most common UTC offset among a trip's items — its "home" time. */
export function homeOffset(trip: TripExport): string | undefined {
  const counts = new Map<string, number>()
  for (const { local } of trip.items) if (local.offset) counts.set(local.offset, (counts.get(local.offset) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** An HTML id for a name (place names have spaces); like the core's slug. */
export function anchor(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'x'
  )
}

const words = (text: string) =>
  new Set(
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  )

/** The title already says every word of the one place's name: no need to repeat it under it. */
export function echoesPlace(title: string, places: { name: string }[]): boolean {
  if (places.length !== 1) return false
  const said = words(title)
  return [...words(places[0].name)].every((w) => said.has(w))
}

/** A party id as it appears in file names: `a+b` → `a~b` (`+` reads as a space in some URLs). */
export const fileKey = (party: string) => party.replaceAll('+', '~')

type Days = { from: string; to: string }[]

/** A plan, or something shown like one (a pass): what ItemRow renders. */
export type RowItem = Omit<Item, 'kind' | 'bookings'> & {
  kind: ItemKind | 'pass'
  /** The days it covers, when that's what it has rather than a time. */
  periods?: Days
  bookings?: (NonNullable<Item['bookings']>[number] & { periods?: Days })[]
}

/**
 * A pass in a plan's shape, so it renders as a booking card like any other:
 * its shares become reservations (each with its own days) once it is held
 * per party. `until` labels the last day, shown where a plan has its time.
 */
export function passItem(pass: Pass, until: string): RowItem {
  const days = pass.shares.flatMap((s) => s.periods)
  const first = days.map((p) => p.from).sort()[0] ?? ''
  const statuses = pass.shares.map((s) => s.status)
  const status: BookingStatus = statuses.includes('required')
    ? 'required'
    : statuses.includes('booked')
      ? 'booked'
      : 'notRequired'
  const deadline = pass.shares.flatMap((s) => (s.status === 'required' && s.deadline ? [s.deadline] : [])).sort()[0]
  const split = pass.shares.length > 1
  return {
    id: pass.id,
    kind: 'pass',
    title: pass.title,
    local: { date: first, time: `– ${until}` },
    places: [pass.area],
    members: pass.members,
    party: pass.party,
    transport: pass.provider ? { carrier: pass.provider } : undefined,
    booking: { status, deadline, hasReference: false },
    bookings: split
      ? pass.shares.map((s) => ({
          status: s.status,
          deadline: s.deadline,
          hasReference: false,
          members: s.members,
          costs: s.costs,
          periods: s.periods,
        }))
      : undefined,
    periods: split ? undefined : days,
    costs: pass.shares.flatMap((s) => s.costs),
    contacts: [],
    notes: pass.notes,
    url: pass.url,
    tags: [],
    overrides: [],
    conflicts: [],
  }
}

/** The last day any share of a pass covers. */
export function passUntil(pass: Pass): string {
  return (
    pass.shares
      .flatMap((s) => s.periods.map((p) => p.to))
      .sort()
      .at(-1) ?? ''
  )
}
