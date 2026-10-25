import { describe, expect, it } from 'vitest'

import { parseFxQuery, shapeRates } from './fx'

const q = (search: string) => parseFxQuery(new URL(`https://x.test/api/fx${search}`))

describe('fx', () => {
  it('validates currency codes', () => {
    expect(q('?base=EUR&quotes=JPY,USD,JPY')).toEqual({ base: 'EUR', quotes: ['JPY', 'USD'] })
    expect(q('?base=eur&quotes=JPY')).toBeNull()
    expect(q('?base=EUR&quotes=JP')).toBeNull()
    expect(q('?base=EUR&quotes=JPY,../x')).toBeNull()
    expect(q('?base=EUR')).toBeNull()
    expect(q('?quotes=JPY')).toBeNull()
  })

  it('shapes upstream rows', () => {
    expect(
      shapeRates('EUR', [
        { date: '2026-10-23', base: 'EUR', quote: 'JPY', rate: 175.5 },
        { date: '2026-10-22', base: 'EUR', quote: 'USD', rate: 1.08 },
      ]),
    ).toEqual({ date: '2026-10-23', base: 'EUR', rates: { JPY: 175.5, USD: 1.08 } })
  })
})
