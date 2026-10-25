import type { Base, BookingStatus, Idea, Item, ItemKind, Member, TripExport } from '@taac/core'
import { marked } from 'marked'

import type { IconName } from '@/components/Icon.astro'

export const kindIcon: Record<ItemKind, IconName> = {
  flight: 'flight',
  train: 'train',
  bus: 'bus',
  ferry: 'ferry',
  transfer: 'transfer',
  lodging: 'lodging',
  activity: 'activity',
  meal: 'meal',
  note: 'note',
}

/** CSS custom property per kind, defined in tokens. */
export const kindTint: Record<ItemKind, string> = {
  flight: 'var(--blue)',
  train: 'var(--teal)',
  bus: 'var(--teal)',
  ferry: 'var(--teal)',
  transfer: 'var(--indigo)',
  lodging: 'var(--purple)',
  activity: 'var(--orange)',
  meal: 'var(--pink)',
  note: 'var(--gray)',
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

/** Human name of a party: everyone, a group, or "A & B". */
export function partyLabel(trip: TripExport, partyId: string, everyone: string, and: string): string {
  if (partyId === 'everyone') return everyone
  const party = trip.parties.find((p) => p.id === partyId)
  const group = party?.group ? trip.groups.find((g) => g.id === party.group) : undefined
  if (group) return group.name
  const names = (party?.members ?? partyId.split('+')).map((id) => memberName(trip, id))
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}${and}${names.at(-1)}` : (names[0] ?? partyId)
}

export function partyEmoji(trip: TripExport, partyId: string): string | undefined {
  const party = trip.parties.find((p) => p.id === partyId)
  return party?.group ? trip.groups.find((g) => g.id === party.group)?.emoji : undefined
}

/** Stable hue per party, for rails and lane headers. */
export function partyHue(partyId: string): number {
  return (memberHue(partyId) + 200) % 360
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

/** Route rows: one per group when groups go separate ways, else one. */
export function routeRows(trip: TripExport): { label?: string; emoji?: string; members: string[]; bases: Base[] }[] {
  const ordered = [...trip.bases].sort((a, b) => a.from.localeCompare(b.from))
  const rows = trip.groups.map((g) => ({
    label: g.name,
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
