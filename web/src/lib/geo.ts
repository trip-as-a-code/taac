// Distances between places, and which areas (a city, a valley: places with
// a radius) hold which places.

import type { TripExport } from '@taac/core'

/** Great-circle metres between two `[lat, lon]` points. */
export function distanceM([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const rad = Math.PI / 180
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 12_742_000 * Math.asin(Math.sqrt(h))
}

/** The areas (places with a radius: a city, a valley) that hold any of `places`, or are one of them. */
export function areasAround(trip: TripExport, places: string[]): string[] {
  return Object.entries(trip.places)
    .filter(([id, area]) => {
      if (!area.radius) return false
      return places.some((p) => {
        const place = trip.places[p]
        return p === id || (place && distanceM(place.geo, area.geo) <= area.radius!)
      })
    })
    .map(([id]) => id)
}
