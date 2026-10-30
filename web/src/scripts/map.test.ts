import { describe, expect, it } from 'vitest'

import { arc } from './map'

describe('arc', () => {
  it('runs end to end', () => {
    const line = arc([0, 0], [10, 0])
    expect(line[0]).toEqual([0, 0])
    expect(line.at(-1)).toEqual([10, 0])
  })

  it('bows the way back to the other side', () => {
    const there = arc([0, 0], [10, 0])
    const back = arc([10, 0], [0, 0])
    const mid = (l: [number, number][]) => l[Math.floor(l.length / 2)]![1]
    expect(Math.sign(mid(there))).toBe(-Math.sign(mid(back)))
  })
})
