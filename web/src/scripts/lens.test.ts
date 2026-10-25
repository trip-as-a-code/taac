import { describe, expect, it } from 'vitest'

import { inLens, lensShare } from './lens'

describe('people lens', () => {
  const plan = ['robin', 'alex']

  it('shows everything with nobody selected', () => {
    expect(inLens(['sam'], { people: [], mode: 'any' })).toBe(true)
  })

  it('any: someone selected takes part', () => {
    expect(inLens(plan, { people: ['alex', 'sam'], mode: 'any' })).toBe(true)
    expect(inLens(plan, { people: ['sam'], mode: 'any' })).toBe(false)
  })

  it('together: everyone selected takes part', () => {
    expect(inLens(plan, { people: ['robin', 'alex'], mode: 'together' })).toBe(true)
    expect(inLens(plan, { people: ['robin', 'sam'], mode: 'together' })).toBe(false)
  })

  it('counts only the selected shares of a cost', () => {
    const shares = { robin: 10, alex: 10, sam: 10 }
    expect(lensShare(shares, { people: ['robin'], mode: 'any' })).toBe(10)
    expect(lensShare(shares, { people: [], mode: 'any' })).toBe(30)
  })
})
