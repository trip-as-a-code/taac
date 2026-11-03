import { describe, expect, it } from 'vitest'

import { along, bearing, curve } from './map'

describe('bearing', () => {
  it('reads clockwise from north', () => {
    expect(Math.round(bearing([0, 0], [0, 1]))).toBe(0)
    expect(Math.round(bearing([0, 0], [1, 0]))).toBe(90)
    expect(Math.round(bearing([0, 0], [0, -1]))).toBe(180)
    expect(Math.round(bearing([0, 0], [-1, 0]))).toBe(270)
  })

  it('points the way back the other way', () => {
    const there = bearing([139.77, 35.68], [135.76, 35.0])
    const back = bearing([135.76, 35.0], [139.77, 35.68])
    expect(Math.round((there - back + 360) % 360)).toBe(180)
  })
})

describe('along', () => {
  it('stays on the straight line the map draws', () => {
    const hel: [number, number] = [24.96, 60.32]
    const hnd: [number, number] = [139.78, 35.55]
    const point = along(hel, hnd, 0.5)
    // Halfway in Mercator: the heading from the start to it is the leg's own heading.
    expect(Math.round(bearing(hel, point))).toBe(Math.round(bearing(hel, hnd)))
    expect(along(hel, hnd, 0)).toEqual(hel)
    expect(along(hel, hnd, 1)[1]).toBeCloseTo(hnd[1], 6)
  })
})

describe('curve', () => {
  // How far the middle of a leg strays from the straight line, in metres.
  const stray = (from: [number, number], to: [number, number]) => {
    const points = curve(from, to)
    const mid = points[Math.floor(points.length / 2)]!
    const straight = along(from, to, 0.5)
    const lat = (mid[1] * Math.PI) / 180
    return Math.hypot((mid[0] - straight[0]) * 111_320 * Math.cos(lat), (mid[1] - straight[1]) * 111_320)
  }

  it('bends a city leg visibly, and a flight across the world no more than that', () => {
    // Honjo-Azumabashi → Shimbashi, about 5 km: bent by a few hundred metres.
    const city = stray([139.8043, 35.7083], [139.7584, 35.6662])
    expect(city).toBeGreaterThan(150)
    expect(city).toBeLessThan(400)
    // Helsinki → Tokyo, about 7800 km: still under a kilometre off, so straight on the map.
    expect(stray([24.96, 60.32], [139.78, 35.55])).toBeLessThan(1000)
  })

  it('bows there and back to opposite sides', () => {
    const a: [number, number] = [139.8043, 35.7083]
    const b: [number, number] = [139.7584, 35.6662]
    const there = curve(a, b)[10]!
    const back = curve(b, a)[10]!
    expect(there).not.toEqual(back)
  })
})
