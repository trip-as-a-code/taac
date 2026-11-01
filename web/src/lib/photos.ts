// Places' photos as this site serves them: any https URL a trip names, under
// an id the server knows from `/_taac/photos.json`, in one of its sizes.

import { createHash } from 'node:crypto'

import type { TripExport } from '@taac/core'

import { isTransport } from './presence'

export type PhotoSize = 'thumb' | 'wide' | 'large'

/** The id the server serves a photo URL under: the start of its SHA-256. */
export function photoId(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

export function photoSrc(url: string, size: PhotoSize): string {
  return `/api/photos/${photoId(url)}/${size}`
}

/** Every photo by id: its URL and the trips using it, for the server. */
export function photoIndex(trips: TripExport[]): Record<string, { url: string; trips: string[] }> {
  const index: Record<string, { url: string; trips: string[] }> = {}
  for (const trip of trips)
    for (const place of Object.values(trip.places)) {
      if (!place.photo) continue
      const entry = (index[photoId(place.photo)] ??= { url: place.photo, trips: [] })
      if (!entry.trips.includes(trip.slug)) entry.trips.push(trip.slug)
    }
  return index
}

/** The photo a plan shows: its first place's; none for getting somewhere, the place shows on what happens there. */
export function photoOf(trip: TripExport, item: { places: string[]; kind: string }): string | undefined {
  if (isTransport(item.kind)) return undefined
  return item.places.map((id) => trip.places[id]?.photo).find(Boolean)
}

/** Each plan's photo in a list, once: a run of plans at one place shows it on the first. */
export function photosOnce<T extends { places: string[]; kind: string }>(
  trip: TripExport,
  items: T[],
): [T, string | null][] {
  const shown = new Set<string>()
  return items.map((item) => {
    const url = photoOf(trip, item)
    const photo = url && !shown.has(url) ? url : null
    if (photo) shown.add(photo)
    return [item, photo]
  })
}
