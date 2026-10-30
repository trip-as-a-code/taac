import type { Base, BookingStatus, Idea, Item, ItemKind, Member, TripExport } from '@taac/core'
import { marked } from 'marked'

import { issuesOf } from '@/lib/facts'

import type { IconName } from '@/components/Icon.astro'

/** Budget categories: every item kind, plus passes and things bought before packing. */
export type CostKind = ItemKind | 'pass' | 'packing'

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
}

export const statusTone: Record<BookingStatus, string | undefined> = {
  required: 'orange',
  booked: 'green',
  notRequired: undefined,
  cancelled: 'red',
}

/** Category → emoji used on map markers. */
export function placeEmoji(category?: string): string {
  const table: Record<string, string> = {
    airport: '✈️',
    station: '🚉',
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

export function partyEmoji(trip: TripExport, partyId: string): string | undefined {
  const party = trip.parties.find((p) => p.id === partyId)
  return party?.group ? trip.groups.find((g) => g.id === party.group)?.emoji : undefined
}

export function baseById(trip: TripExport): Map<string, Base> {
  return new Map(trip.bases.map((b) => [b.id, b]))
}

/** Ideas per area key ('' for ideas without one), in declaration order. */
export function ideasByArea(trip: TripExport): Map<string, Idea[]> {
  const out = new Map<string, Idea[]>()
  for (const idea of trip.ideas) {
    const key = idea.area ?? ''
    out.set(key, [...(out.get(key) ?? []), idea])
  }
  return out
}

/** Great-circle metres between two `[lat, lon]` points. */
function distanceM([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 12_742_000 * Math.asin(Math.sqrt(h))
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
 * Must-dos first.
 */
export function ideasAt(trip: TripExport, base: Base): Idea[] {
  return trip.ideas
    .filter(
      (idea) =>
        (idea.area ? inBase(trip, base, idea.area) : idea.places.some((p) => inBase(trip, base, p))) &&
        idea.members.some((m) => base.members.includes(m)) &&
        // Nobody chose who it's for yet: not suggested until someone does.
        !issuesOf(trip, idea.id).some((d) => d.code === 'item.unassigned'),
    )
    .sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'))
}

/** Route rows: one per group when groups go separate ways, else one. */
export function routeRows(
  trip: TripExport,
  and: string,
): { label?: string; emoji?: string; members: string[]; bases: Base[] }[] {
  const ordered = [...trip.bases].sort((a, b) => a.from.localeCompare(b.from))
  const rows = trip.groups.map((g) => ({
    label: groupLabel(trip, g, and),
    emoji: g.emoji,
    members: g.members,
    bases: ordered.filter((b) => g.members.every((m) => b.members.includes(m))),
  }))
  const same = rows.every((r) => r.bases.map((b) => b.id).join() === rows[0]?.bases.map((b) => b.id).join())
  return rows.length === 0 || same ? [{ members: trip.members.map((m) => m.id), bases: ordered }] : rows
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
