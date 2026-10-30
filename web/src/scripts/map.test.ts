import { describe, expect, it } from 'vitest'

import { bearing } from './map'

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
