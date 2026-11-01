import 'maplibre-gl/dist/maplibre-gl.css'

import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

import type { FeatureCollection, GeoJSON } from 'geojson'
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibre, Marker, Popup } from 'maplibre-gl'

import type { Facts } from '@/lib/facts'
import { matchesFacts, setupFilters, showCount, tripToday, type FilterState } from '@/scripts/filters'
import { getLens, inLens, setLens, type Lens } from '@/scripts/lens'
import { currentTheme, onTheme } from '@/scripts/theme'

interface MapData {
  places: {
    id: string
    name: string
    geo: [number, number]
    emoji: string
    photo?: string
    items: string[]
    idea: boolean
  }[]
  routes: { item: string; flight: boolean; color: string; coords: [number, number][] }[]
  items: Record<
    string,
    {
      title: string
      kind: string
      date: string | null
      when: string
      people: string[]
      facts: Facts
      href: string
      /** Kinds of issue the validator found; their entry in the overview's list. */
      issues?: number
      issuesHref?: string
    }
  >
  areas: {
    id: string
    title: string
    center: [number, number]
    radius: number
    from: string
    to: string
    people: string[]
  }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
}

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

let map: MapLibre | undefined
let offTheme: (() => void) | undefined

export async function setupMap() {
  const container = document.querySelector<HTMLElement>('[data-map]')
  const raw = document.getElementById('map-data')?.textContent
  if (!container || !raw) return
  const data = JSON.parse(raw) as MapData
  const maplibregl = await import('maplibre-gl')
  maplibregl.setWorkerUrl(workerUrl)

  map?.remove()
  const dark = currentTheme() === 'dark'
  const instance = new maplibregl.Map({
    container,
    style: dark ? STYLES.dark : STYLES.light,
    bounds: bounds(core(data.places.map((p) => p.geo))),
    fitBoundsOptions: { padding: padding() },
    attributionControl: { compact: true },
    cooperativeGestures: window.matchMedia('(max-width: 760px)').matches,
  })
  map = instance
  instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  instance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right')

  const state: { lens: Lens; day: string; filters?: FilterState } = { lens: getLens(), day: '' }
  const visibleItems = () => {
    const today = tripToday()
    return Object.entries(data.items)
      .filter(
        ([, item]) =>
          (state.filters
            ? matchesFacts(item.facts, item.people, state.filters, today)
            : inLens(item.people, state.lens, item.facts.unassigned)) &&
          (!state.day || item.date === state.day),
      )
      .map(([id]) => id)
  }

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
          // Each leg keeps to its right: there and back over the same ground are two lines.
          'line-offset': ROUTE_OFFSET,
        },
      })
      if (!instance.hasImage('route-arrow')) instance.addImage('route-arrow', arrowImage(), { sdf: true })
      instance.addSource('route-arrows', { type: 'geojson', data: arrowData(data, visibleItems()) })
      instance.addLayer({
        id: 'route-arrows',
        type: 'symbol',
        source: 'route-arrows',
        layout: {
          'icon-image': 'route-arrow',
          'icon-size': 0.9,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          // On its line, which sits to the right of the leg's direction.
          'icon-offset': [ROUTE_OFFSET / 0.9, 0],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: { 'icon-color': ['get', 'color'] },
      })
    }
  }
  instance.on('style.load', addLayers)
  offTheme?.()
  offTheme = onTheme((theme) => instance.setStyle(STYLES[theme]))

  const issuesLabel = container.dataset.issues ?? ''
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
      .map((i) => {
        const issues = i.issues
          ? `<a class="popup-issues" href="${i.issuesHref}" title="${escape(issuesLabel)}">⚠︎ ${i.issues}</a>`
          : ''
        return `<li><a href="${i.href}"><span>${escape(i.title)}</span><span>${escape(i.when)}</span></a>${issues}</li>`
      })
      .join('')
    popup?.remove()
    const photo = place.photo
      ? `<img class="popup-photo" src="${escape(place.photo)}" alt="" width="300" height="120" data-photo-img data-photo-keep data-photo="${escape(place.photo.replace(/\/wide$/, '/large'))}" data-photo-title="${escape(place.name)}" />`
      : ''
    popup = new maplibregl.Popup({ offset: 20, maxWidth: '300px', focusAfterOpen: false })
      .setLngLat([place.geo[1], place.geo[0]])
      .setHTML(`<div class="popup">${photo}<h3>${escape(place.name)}</h3><ul>${list}</ul></div>`)
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

  // The list names what is on the map right now; the rest is a tap away.
  let shown: MapData['places'] = []
  const listVisible = () => {
    const view = instance.getBounds()
    let inside = 0
    const shownIds = new Set(shown.map((p) => p.id))
    for (const [id, button] of listButtons) {
      const place = data.places.find((p) => p.id === id)!
      const visible = shownIds.has(id) && view.contains([place.geo[1], place.geo[0]])
      button.parentElement!.hidden = !visible
      if (visible) inside++
    }
    document.querySelector('[data-place-count]')!.textContent = String(inside)
    document.querySelector<HTMLElement>('[data-no-places]')!.hidden = shown.length > 0
    const outside = document.querySelector<HTMLElement>('[data-outside]')
    const text = outside?.querySelector<HTMLElement>('[data-outside-text]')
    if (outside && text) {
      const rest = shown.length - inside
      outside.hidden = rest <= 0
      text.textContent = plural(text.dataset.template!, rest)
    }
  }
  instance.on('moveend', listVisible)

  const apply = (fit: boolean) => {
    const allowed = new Set(visibleItems())
    showCount(allowed.size, Object.keys(data.items).length)
    shown = data.places.filter((p) => p.items.some((i) => allowed.has(i)))
    const shownIds = new Set(shown.map((p) => p.id))
    for (const [id, marker] of markers) marker.getElement().hidden = !shownIds.has(id)
    // Places whose plans in view have issues say how many kinds.
    for (const [id, button] of listButtons) {
      const place = data.places.find((p) => p.id === id)!
      const issues = place.items.filter((i) => allowed.has(i)).reduce((n, i) => n + (data.items[i].issues ?? 0), 0)
      const badge = button.querySelector<HTMLElement>('[data-place-issues]')!
      badge.hidden = issues === 0
      badge.textContent = `⚠︎ ${issues}`
      badge.title = issuesLabel
    }
    listVisible()
    ;(instance.getSource('routes') as GeoJSONSource | undefined)?.setData(routeData(data, [...allowed]))
    ;(instance.getSource('route-arrows') as GeoJSONSource | undefined)?.setData(arrowData(data, [...allowed]))
    ;(instance.getSource('areas') as GeoJSONSource | undefined)?.setData(areaData(data, state))
    popup?.remove()
    // The trip's own area: a flight home from far away doesn't zoom the map
    // out to the whole world.
    if (fit && shown.length)
      instance.fitBounds(bounds(core(shown.map((p) => p.geo))), { padding: padding(), maxZoom: 14, duration: 700 })
  }

  setupFilters((filters) => {
    state.lens = filters.lens
    state.filters = filters
    apply(instance.loaded())
  })
  document.querySelector<HTMLSelectElement>('[data-day-filter]')?.addEventListener('change', (event) => {
    state.day = (event.target as HTMLSelectElement).value
    apply(true)
  })
  document.querySelector('[data-fit]')?.addEventListener('click', () => apply(true))
  // First the trip's area; once that is all in view, the far-off rest too.
  document.querySelector('[data-show-all]')?.addEventListener('click', () => {
    if (!shown.length) return
    const view = instance.getBounds()
    const area = core(shown.map((p) => p.geo))
    const target = area.every((g) => view.contains([g[1], g[0]])) ? shown.map((p) => p.geo) : area
    instance.fitBounds(bounds(target), { padding: padding(), maxZoom: 14, duration: 700 })
  })
  // `#item-<id>` from a plan or idea: its places, framed, the first one
  // open. The camera moves at once; the popup is reopened after `load`,
  // whose refresh closes it.
  let pinned: string | undefined
  const target = () => {
    const id = decodeURIComponent(location.hash.slice(1)).replace(/^item-/, '')
    const item = data.items[id]
    const at = data.places.filter((p) => p.items.includes(id))
    if (!item || !at.length) return
    // A plan the people lens hides would put nothing on the map.
    if (!visibleItems().includes(id)) setLens({ people: [], unassigned: Boolean(item.facts.unassigned) })
    if (at.length > 1)
      instance.fitBounds(bounds(at.map((p) => p.geo)), { padding: padding(), maxZoom: 14, duration: 0 })
    else instance.jumpTo({ center: [at[0].geo[1], at[0].geo[0]], zoom: Math.max(instance.getZoom(), 13) })
    pinned = at[0].id
    open(pinned, false)
  }
  target()
  instance.once('load', () => {
    apply(false)
    if (pinned) open(pinned, false)
  })
  window.addEventListener('hashchange', target)
}

/** Base areas as 64-gon circles, filtered by who and day. */
function areaData(data: MapData, state: { lens: Lens; day: string }): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.areas
      .filter((a) => inLens(a.people, state.lens) && (!state.day || (a.from <= state.day && state.day <= a.to)))
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

/**
 * Compass bearing from one point to another as drawn on the (Web Mercator)
 * map, in degrees clockwise from north.
 */
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const unmerc = (y: number) => (Math.atan(Math.sinh(y)) * 180) / Math.PI

/** The point a fraction `t` of the way along a leg, on the straight line the map draws (Mercator). */
export function along([x1, y1]: [number, number], [x2, y2]: [number, number], t: number): [number, number] {
  return [x1 + (x2 - x1) * t, unmerc(merc(y1) + (merc(y2) - merc(y1)) * t)]
}

export function bearing([x1, y1]: [number, number], [x2, y2]: [number, number]): number {
  const dx = ((x2 - x1) * Math.PI) / 180
  const dy = merc(y2) - merc(y1)
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

const ROUTE_OFFSET = 3

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

/** An arrowhead near the end of every leg: which way it goes, in or out. */
function arrowData(data: MapData, items: string[]): FeatureCollection {
  const allowed = new Set(items)
  return {
    type: 'FeatureCollection',
    features: data.routes
      .filter((r) => allowed.has(r.item))
      .flatMap((r) =>
        r.coords.slice(1).map((to, i) => {
          const from = r.coords[i]!
          return {
            type: 'Feature' as const,
            properties: { color: resolveColor(r.color), bearing: bearing(from, to) },
            geometry: { type: 'Point' as const, coordinates: along(from, to, 0.82) },
          }
        }),
      ),
  }
}

/** A chevron pointing up, as a signed-distance image so it takes each route's colour. */
function arrowImage(): { width: number; height: number; data: Uint8Array } {
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(6, 15)
  ctx.lineTo(12, 8)
  ctx.lineTo(18, 15)
  ctx.stroke()
  return { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer) }
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
  // On phones the places sheet covers the lower part of the map.
  const sheet = document.querySelector<HTMLElement>('[data-panel]')?.offsetHeight ?? 0
  return narrow ? { top: 40, bottom: sheet + 30, left: 30, right: 30 } : { top: 60, bottom: 60, left: 420, right: 60 }
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** `{ one, few, many, other }` forms joined by `|` in a data attribute. */
function plural(template: string, n: number): string {
  const forms = JSON.parse(template) as Record<string, string>
  const form = new Intl.PluralRules(document.documentElement.lang).select(n)
  return (forms[form] ?? forms.other).replace('{n}', String(n))
}
