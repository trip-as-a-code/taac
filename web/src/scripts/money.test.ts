import { describe, expect, it } from 'vitest'

import { priceText } from './money'

const rates = { date: '2026-10-30', rates: { EUR: 1, JPY: 160, USD: 1.08 } }

describe('priceText', () => {
  it('converts what is not in the display currency, marked as an estimate', () => {
    expect(priceText({ amount: 16000, currency: 'JPY' }, 'EUR', rates, 'en')).toBe('≈ €100')
  })

  it('keeps a price already in the display currency exact', () => {
    expect(priceText({ amount: 45, currency: 'EUR' }, 'EUR', rates, 'en')).toBe('€45')
  })

  it('prefers what was actually charged', () => {
    const charged = { amount: 6.1, currency: 'EUR' }
    expect(priceText({ amount: 1000, currency: 'JPY', charged }, 'EUR', rates, 'en')).toBe('€6.10')
  })

  it('has nothing to say without a rate', () => {
    expect(priceText({ amount: 10, currency: 'GBP' }, 'EUR', rates, 'en')).toBeNull()
    expect(priceText({ amount: 10, currency: 'JPY' }, 'EUR', null, 'en')).toBeNull()
  })
})
