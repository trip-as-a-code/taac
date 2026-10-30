import { describe, expect, it } from 'vitest'

import { along, bearing } from './map'

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
