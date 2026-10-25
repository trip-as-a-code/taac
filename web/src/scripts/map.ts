import 'maplibre-gl/dist/maplibre-gl.css'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import type { FeatureCollection, GeoJSON } from 'geojson'
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibre, Marker, Popup } from 'maplibre-gl'

import { setupFilters, type FilterState } from '@/scripts/filters'

interface MapData {
  places: { id: string; name: string; geo: [number, number]; emoji: string; items: string[]; idea: boolean }[]
  routes: { item: string; flight: boolean; color: string; coords: [number, number][] }[]
  items: Record<
    string,
    { title: string; kind: string; date: string | null; when: string; tokens: string; href: string }
  >
  areas: {
    id: string
    title: string
    center: [number, number]
    radius: number
    from: string
    to: string
    tokens: string
  }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
}

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

let map: MapLibre | undefined

export async function setupMap() {
  const container = document.querySelector<HTMLElement>('[data-map]')
  const raw = document.getElementById('map-data')?.textContent
  if (!container || !raw) return
  const data = JSON.parse(raw) as MapData
  const maplibregl = await import('maplibre-gl')
  maplibregl.setWorkerUrl(workerUrl)

  map?.remove()
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const instance = new maplibregl.Map({
    container,
    style: dark.matches ? STYLES.dark : STYLES.light,
    bounds: bounds(core(data.places.map((p) => p.geo))),
    fitBoundsOptions: { padding: padding() },
    attributionControl: { compact: true },
    cooperativeGestures: window.matchMedia('(max-width: 760px)').matches,
  })
  map = instance
  instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  instance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right')

  const state: FilterState & { day: string } = { who: '', status: '', day: '' }
  const visibleItems = () =>
    Object.entries(data.items)
      .filter(
        ([, item]) =>
          (!state.who || item.tokens.split(' ').includes(state.who)) && (!state.day || item.date === state.day),
      )
      .map(([id]) => id)

  // Overlays and routes are re-added whenever the style (light/dark) loads.
  const addLayers = () => {
    for (const [index, overlay] of data.overlays.entries()) {
      const id = `overlay-${index}`
      if (instance.getSource(id)) continue
      instance.addSource(id, { type: 'geojson', data: overlay.data as GeoJSON })
      instance.addLayer({
        id,
        type: 'line',
        source: id,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#8e8e93', 'line-width': 1.5, 'line-opacity': 0.55, 'line-dasharray': [3, 2] },
      })
    }
    if (!instance.getSource('areas')) {
      instance.addSource('areas', { type: 'geojson', data: areaData(data, state) })
      instance.addLayer({
        id: 'areas-fill',
        type: 'fill',
        source: 'areas',
        paint: { 'fill-color': resolveColor('var(--blue)'), 'fill-opacity': 0.07 },
      })
      instance.addLayer({
        id: 'areas-line',
        type: 'line',
        source: 'areas',
        paint: {
          'line-color': resolveColor('var(--blue)'),
          'line-opacity': 0.45,
          'line-width': 1.5,
          'line-dasharray': [2, 2],
        },
      })
    }
    if (!instance.getSource('routes')) {
      instance.addSource('routes', { type: 'geojson', data: routeData(data, visibleItems()) })
      instance.addLayer({
        id: 'routes',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.85,
          'line-dasharray': ['case', ['get', 'flight'], ['literal', [1, 2]], ['literal', [1, 0]]],
        },
      })
    }
  }
  instance.on('style.load', addLayers)
  dark.addEventListener('change', (event) => instance.setStyle(event.matches ? STYLES.dark : STYLES.light))

  const markers = new Map<string, Marker>()
  let popup: Popup | undefined
  const listButtons = new Map(
    [...document.querySelectorAll<HTMLButtonElement>('[data-place]')].map((b) => [b.dataset.place!, b]),
  )

  const open = (id: string, fly: boolean) => {
    const place = data.places.find((p) => p.id === id)
    if (!place) return
    const allowed = new Set(visibleItems())
    const list = place.items
      .filter((i) => allowed.has(i))
      .map((i) => data.items[i])
      .map((i) => `<li><a href="${i.href}"><span>${escape(i.title)}</span><span>${escape(i.when)}</span></a></li>`)
      .join('')
    popup?.remove()
    popup = new maplibregl.Popup({ offset: 20, maxWidth: '300px', focusAfterOpen: false })
      .setLngLat([place.geo[1], place.geo[0]])
      .setHTML(`<div class="popup"><h3>${escape(place.name)}</h3><ul>${list}</ul></div>`)
      .addTo(instance)
    for (const [key, button] of listButtons) button.setAttribute('aria-current', String(key === id))
    if (fly)
      instance.flyTo({ center: [place.geo[1], place.geo[0]], zoom: Math.max(instance.getZoom(), 13), duration: 900 })
  }

  for (const place of data.places) {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'marker'
    element.textContent = place.emoji
    if (place.idea) element.dataset.idea = ''
    element.setAttribute('aria-label', place.name)
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      open(place.id, false)
    })
    markers.set(place.id, new maplibregl.Marker({ element }).setLngLat([place.geo[1], place.geo[0]]).addTo(instance))
  }
  for (const [id, button] of listButtons) button.addEventListener('click', () => open(id, true))

  const apply = (fit: boolean) => {
    const allowed = new Set(visibleItems())
    const shown = data.places.filter((p) => p.items.some((i) => allowed.has(i)))
    const shownIds = new Set(shown.map((p) => p.id))
    for (const [id, marker] of markers) marker.getElement().hidden = !shownIds.has(id)
    for (const [id, button] of listButtons) button.parentElement!.hidden = !shownIds.has(id)
    document.querySelector('[data-place-count]')!.textContent = String(shown.length)
    document.querySelector<HTMLElement>('[data-no-places]')!.hidden = shown.length > 0
    ;(instance.getSource('routes') as GeoJSONSource | undefined)?.setData(routeData(data, [...allowed]))
    ;(instance.getSource('areas') as GeoJSONSource | undefined)?.setData(areaData(data, state))
    popup?.remove()
    if (fit && shown.length)
      instance.fitBounds(bounds(shown.map((p) => p.geo)), { padding: padding(), maxZoom: 14, duration: 700 })
  }

  setupFilters((filters) => {
    state.who = filters.who
    apply(instance.loaded())
  })
  document.querySelector<HTMLSelectElement>('[data-day-filter]')?.addEventListener('change', (event) => {
    state.day = (event.target as HTMLSelectElement).value
    apply(true)
  })
  document.querySelector('[data-fit]')?.addEventListener('click', () => apply(true))
  instance.once('load', () => apply(false))
}

/** Base areas as 64-gon circles, filtered by who and day. */
function areaData(data: MapData, state: { who: string; day: string }): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.areas
      .filter(
        (a) =>
          (!state.who || a.tokens.split(' ').includes(state.who)) &&
          (!state.day || (a.from <= state.day && state.day <= a.to)),
      )
      .map((a) => ({
        type: 'Feature',
        properties: { title: a.title },
        geometry: { type: 'Polygon', coordinates: [circle(a.center, a.radius)] },
      })),
  }
}

function circle([lon, lat]: [number, number], radius: number): [number, number][] {
  const points: [number, number][] = []
  const dLat = radius / 111_320
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * 2 * Math.PI
    points.push([lon + dLon * Math.cos(angle), lat + dLat * Math.sin(angle)])
  }
  return points
}

function routeData(data: MapData, items: string[]): FeatureCollection {
  const allowed = new Set(items)
  return {
    type: 'FeatureCollection',
    features: data.routes
      .filter((r) => allowed.has(r.item))
      .map((r) => ({
        type: 'Feature',
        properties: { color: resolveColor(r.color), flight: r.flight },
        geometry: { type: 'LineString', coordinates: r.coords },
      })),
  }
}

/** Map styles can't read CSS variables; resolve `var(--x)` once. */
function resolveColor(value: string): string {
  const name = value.match(/var\((--[\w-]+)\)/)?.[1]
  return name ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0071e3' : value
}

function bounds(geos: [number, number][]): LngLatBoundsLike {
  if (!geos.length) return [-30, -50, 60, 70]
  const lons = geos.map((g) => g[1])
  const lats = geos.map((g) => g[0])
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

/** Drops far-flung points (the flight home) so the first view frames the destination. */
function core(geos: [number, number][]): [number, number][] {
  if (geos.length < 4) return geos
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const center: [number, number] = [median(geos.map((g) => g[0])), median(geos.map((g) => g[1]))]
  const near = geos.filter((g) => distanceKm(g, center) < 1500)
  return near.length >= geos.length / 2 ? near : geos
}

function distanceKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 12_742 * Math.asin(Math.sqrt(a))
}

function padding() {
  const narrow = window.matchMedia('(max-width: 760px)').matches
  return narrow ? { top: 40, bottom: 60, left: 30, right: 30 } : { top: 60, bottom: 60, left: 420, right: 60 }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
