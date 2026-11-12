import { describe, expect, it } from 'vitest'

import { merge, packingSlug, type Ticks } from './packing'

describe('packing ticks', () => {
  it('keeps the latest tick per person and item', () => {
    const ticks: Ticks = { 'adapter|a': { packed: true, at: 20 } }
    expect(
      merge(
        ticks,
        [
          { item: 'adapter', member: 'a', packed: false, at: 10 },
          { item: 'adapter', member: 'b', packed: true, at: 5 },
        ],
        100,
      ),
    ).toBe(1)
    expect(ticks).toEqual({ 'adapter|a': { packed: true, at: 20 }, 'adapter|b': { packed: true, at: 5 } })
    merge(ticks, [{ item: 'adapter', member: 'a', packed: false, at: 30 }], 100)
    expect(ticks['adapter|a']).toEqual({ packed: false, at: 30 })
  })

  it('remembers who set a tick, and who set it last', () => {
    const ticks: Ticks = {}
    merge(ticks, [{ item: 'adapter', member: 'a', packed: true, at: 1 }], 100, 'sam')
    expect(ticks['adapter|a']).toEqual({ packed: true, at: 1, by: 'sam' })
    merge(ticks, [{ item: 'adapter', member: 'a', packed: false, at: 2, by: 'forged' }], 100, 'alex')
    // An untick remembers whose tick it took back.
    expect(ticks['adapter|a']).toEqual({ packed: false, at: 2, by: 'alex', undid: 'sam' })
    merge(ticks, [{ item: 'adapter', member: 'a', packed: false, at: 3 }], 100, 'alex')
    expect(ticks['adapter|a']).toEqual({ packed: false, at: 3, by: 'alex' })
  })

  it('ignores malformed and far-future changes', () => {
    const ticks: Ticks = {}
    const now = Date.now()
    expect(
      merge(
        ticks,
        [
          { item: 'a|b', member: 'x', packed: true, at: 1 },
          { item: 'ok', member: 'x', packed: 'yes', at: 1 },
          { item: 'ok', member: 'x', packed: true, at: now + 7 * 86_400_000 },
          'nope',
        ],
        now,
      ),
    ).toBe(0)
    expect(merge(ticks, { not: 'a list' }, now)).toBe(0)
  })

  it('serves only trip packing paths', () => {
    expect(packingSlug('/trips/japan-2026/_packing')).toBe('japan-2026')
    expect(packingSlug('/trips/japan-2026/packing/')).toBeNull()
  })
})
