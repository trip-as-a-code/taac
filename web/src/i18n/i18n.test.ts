import { describe, expect, it } from 'vitest'

import { en } from './en'
import { localePath, switchLocalePath, useI18n } from './index'
import { ru } from './ru'

describe('i18n', () => {
  it('has every key in every locale', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
  })

  it('pluralises per locale rules', () => {
    const r = useI18n('ru')
    expect(r.plural('trip.days', 1)).toBe('1 день')
    expect(r.plural('trip.days', 3)).toBe('3 дня')
    expect(r.plural('trip.days', 34)).toBe('34 дня')
    expect(r.plural('trip.days', 11)).toBe('11 дней')
    expect(useI18n('en').plural('trip.days', 1)).toBe('1 day')
  })

  it('formats date-only strings without time-zone drift', () => {
    expect(useI18n('en').date('2026-12-10', { day: 'numeric', month: 'short' })).toBe('Dec 10')
  })

  it('maps paths between locales', () => {
    expect(localePath('en', '/trips/x/')).toBe('/trips/x/')
    expect(localePath('ru', '/')).toBe('/ru/')
    expect(switchLocalePath('/trips/x/map/', 'ru')).toBe('/ru/trips/x/map/')
    expect(switchLocalePath('/ru/trips/x/', 'en')).toBe('/trips/x/')
  })
})
