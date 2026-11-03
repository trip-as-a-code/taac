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
    /** A station, stop or port: drawn as a dot. */
    stop: boolean
  }[]
  routes: { item: string; flight: boolean; walk: boolean; color: string; coords: [number, number][] }[]
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
      .filter(([, item]) =>
        state.filters
          ? matchesFacts(item.facts, item.people, state.filters, today)
          : inLens(item.people, state.lens, item.facts.unassigned),
      )
      .map(([id]) => id)
  }
  /** With a day picked, its plans are the focus; the rest of the trip stays as faint context. */
  const focused = (items: string[]) => (state.day ? items.filter((id) => data.items[id]!.date === state.day) : items)

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
      instance.addSource('routes-context', { type: 'geojson', data: routeData(data, []) })
      instance.addLayer({
        id: 'routes-context',
        type: 'line',
        source: 'routes-context',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['get', 'count'], 1, 1.5, 6, 4],
          'line-opacity': 0.16,
        },
      })
      instance.addSource('routes', { type: 'geojson', data: routeData(data, focused(visibleItems())) })
      instance.addLayer({
        id: 'routes',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          // The same leg travelled again is one line, thicker the more often.
          'line-width': ['interpolate', ['linear'], ['get', 'count'], 1, 3, 6, 7],
          'line-opacity': 0.85,
          // Flights dashed, walks dotted; colour says whose journey it is.
          'line-dasharray': [
            'case',
            ['get', 'flight'],
            ['literal', [1, 2]],
            ['get', 'walk'],
            ['literal', [0.1, 1.8]],
            ['literal', [1, 0]],
          ],
          // Each leg keeps to its right: there and back over the same ground are two lines.
          'line-offset': ROUTE_OFFSET,
        },
      })
      if (!instance.hasImage('route-arrow')) instance.addImage('route-arrow', arrowImage(), { sdf: true })
      instance.addSource('route-arrows', { type: 'geojson', data: arrowData(data, focused(visibleItems())) })
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

  // A leg travelled on several days says how often, under the pointer.
  const tripsForms = container.dataset.trips ?? '{}'
  const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'route-hint' })
  for (const layer of ['routes', 'routes-context']) {
    instance.on('mousemove', layer, (event) => {
      const count = Number(event.features?.[0]?.properties?.count ?? 1)
      if (count < 2) return void hover.remove()
      hover.setLngLat(event.lngLat).setText(plural(tripsForms, count)).addTo(instance)
    })
    instance.on('mouseleave', layer, () => hover.remove())
  }
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
    if (place.stop) element.dataset.stop = ''
    element.setAttribute('aria-label', place.name)
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      open(place.id, false)
    })
    markers.set(place.id, new maplibregl.Marker({ element }).setLngLat([place.geo[1], place.geo[0]]).addTo(instance))
  }
  for (const [id, button] of listButtons) button.addEventListener('click', () => open(id, true))

  // Places close together on screen gather into one bubble with a count, and
  // split as the map zooms in; a tap zooms to them. Stations stay dots, and
  // the day in focus and the rest gather apart.
  const clusterForms = container.dataset.cluster ?? '{}'
  const bubbles: Marker[] = []
  const cluster = () => {
    for (const bubble of bubbles.splice(0)) bubble.remove()
    for (const marker of markers.values()) marker.getElement().removeAttribute('data-clustered')
    if (instance.getZoom() >= 15) return
    const candidates = data.places
      .map((place) => ({ place, element: markers.get(place.id)!.getElement() }))
      .filter(({ place, element }) => !place.stop && !element.hidden)
      .map((c) => ({ ...c, at: instance.project([c.place.geo[1], c.place.geo[0]]) }))
    const taken = new Set<string>()
    for (const c of candidates) {
      if (taken.has(c.place.id)) continue
      const faded = c.element.hasAttribute('data-faded')
      const near = candidates.filter(
        (o) =>
          !taken.has(o.place.id) &&
          o.element.hasAttribute('data-faded') === faded &&
          Math.hypot(o.at.x - c.at.x, o.at.y - c.at.y) < CLUSTER_PX,
      )
      if (near.length < 2) continue
      for (const o of near) {
        taken.add(o.place.id)
        o.element.setAttribute('data-clustered', '')
      }
      const geos = near.map((o) => o.place.geo)
      const element = document.createElement('button')
      element.type = 'button'
      element.className = 'marker bubble'
      element.toggleAttribute('data-faded', faded)
      element.textContent = String(near.length)
      element.setAttribute('aria-label', plural(clusterForms, near.length))
      element.title = near.map((o) => o.place.name).join('\n')
      element.addEventListener('click', (event) => {
        event.stopPropagation()
        instance.fitBounds(bounds(geos), { padding: 80, maxZoom: Math.max(instance.getZoom() + 2, 15), duration: 600 })
      })
      const lat = geos.reduce((sum, g) => sum + g[0], 0) / geos.length
      const lon = geos.reduce((sum, g) => sum + g[1], 0) / geos.length
      bubbles.push(new maplibregl.Marker({ element }).setLngLat([lon, lat]).addTo(instance))
    }
  }
  instance.on('zoomend', cluster)

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
    const focus = new Set(focused([...allowed]))
    for (const [id, marker] of markers) {
      const place = data.places.find((p) => p.id === id)!
      marker.getElement().hidden = !shownIds.has(id)
      marker.getElement().toggleAttribute('data-faded', Boolean(state.day) && !place.items.some((i) => focus.has(i)))
    }
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
    cluster()
    const context = state.day ? [...allowed].filter((id) => !focus.has(id)) : []
    ;(instance.getSource('routes-context') as GeoJSONSource | undefined)?.setData(routeData(data, context))
    ;(instance.getSource('routes') as GeoJSONSource | undefined)?.setData(routeData(data, [...focus]))
    ;(instance.getSource('route-arrows') as GeoJSONSource | undefined)?.setData(arrowData(data, [...focus]))
    ;(instance.getSource('areas') as GeoJSONSource | undefined)?.setData(areaData(data, state))
    popup?.remove()
    // The trip's own area: a flight home from far away doesn't zoom the map
    // out to the whole world.
    // Framed on the day in focus, else on everything in view.
    const framed = state.day ? shown.filter((p) => p.items.some((i) => focus.has(i))) : shown
    if (fit && framed.length)
      instance.fitBounds(bounds(core(framed.map((p) => p.geo))), { padding: padding(), maxZoom: 14, duration: 700 })
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
  document.querySelector('[data-fit-trip]')?.addEventListener('click', () => apply(true))
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
/** How close on screen places gather into one bubble. */
const CLUSTER_PX = 34

/** The bend of a leg at most, on the ground: city legs fan apart, a long flight stays straight. */
const BEND_M = 600

/**
 * A leg as a gentle curve bowed to the right of travel, so there and back over
 * the same ground are two lines, and legs leaving one station fan apart. The
 * bend is a sixth of the leg, but never more than `BEND_M`: a flight across
 * the world bends no more than a walk.
 */
export function curve(from: [number, number], to: [number, number], steps = 20): [number, number][] {
  // In Web Mercator, where the map draws it, with both axes in radians: a
  // unit there is the Earth's radius times the cosine of the latitude.
  const rad = Math.PI / 180
  const [x1, y1] = [from[0] * rad, merc(from[1])]
  const [x2, y2] = [to[0] * rad, merc(to[1])]
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (!length) return [from, to]
  const metresPerUnit = 6_371_000 * Math.cos(((from[1] + to[1]) / 2) * rad) || 1
  const bend = Math.min(length / 6, BEND_M / metresPerUnit)
  const cx = (x1 + x2) / 2 + (dy / length) * bend
  const cy = (y1 + y2) / 2 - (dx / length) * bend
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    const u = 1 - t
    return [(u * u * x1 + 2 * u * t * cx + t * t * x2) / rad, unmerc(u * u * y1 + 2 * u * t * cy + t * t * y2)]
  })
}

/** A route's legs once each, however many times they were travelled: the key, how often, and one of them. */
function merged(data: MapData, items: string[]) {
  const allowed = new Set(items)
  const legs = new Map<string, { route: MapData['routes'][number]; count: number }>()
  for (const route of data.routes.filter((r) => allowed.has(r.item))) {
    const key = [route.color, route.flight, route.walk, ...route.coords.flat()].join(',')
    const leg = legs.get(key)
    if (leg) leg.count++
    else legs.set(key, { route, count: 1 })
  }
  return [...legs.values()]
}

function routeData(data: MapData, items: string[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: merged(data, items).map(({ route: r, count }) => ({
      type: 'Feature',
      properties: { color: resolveColor(r.color), flight: r.flight, walk: r.walk, count },
      geometry: {
        type: 'LineString',
        coordinates: r.coords.flatMap((c, i) => (i === 0 ? [] : curve(r.coords[i - 1]!, c).slice(i === 1 ? 0 : 1))),
      },
    })),
  }
}

/** An arrowhead near the end of every leg, on its curve: which way it goes, in or out. */
function arrowData(data: MapData, items: string[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: merged(data, items).flatMap(({ route: r }) =>
      r.coords.slice(1).map((to, i) => {
        const points = curve(r.coords[i]!, to)
        const at = Math.round((points.length - 1) * 0.82)
        return {
          type: 'Feature' as const,
          properties: {
            color: resolveColor(r.color),
            bearing: bearing(points[at - 1]!, points[at + 1] ?? points[at]!),
          },
          geometry: { type: 'Point' as const, coordinates: points[at]! },
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
