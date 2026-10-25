import { describe, expect, it } from 'vitest'

import { fold, type Facts } from '../lib/facts'
import { matchesFacts, type FilterState } from './filters'

const today = '2026-12-14'
const base: Facts = {
  kind: 'activity',
  priced: false,
  payers: [],
  places: [],
  tags: [],
  issues: [],
  text: 'tram 28 castelo',
}
const state = (values: FilterState['values'], q = ''): FilterState => ({
  lens: { people: [], mode: 'any' },
  values,
  q,
})
const match = (facts: Partial<Facts>, values: FilterState['values'], q = '') =>
  matchesFacts({ ...base, ...facts }, ['a'], state(values, q), today)

describe('filters', () => {
  it('passes everything without facets', () => {
    expect(matchesFacts(undefined, ['a'], state({}), today)).toBe(true)
  })

  it('ORs values within a facet and ANDs facets', () => {
    expect(match({ kind: 'train' }, { kind: ['train', 'flight'] })).toBe(true)
    expect(match({ kind: 'train', status: 'booked' }, { kind: ['train'], status: ['required'] })).toBe(false)
  })

  it('reads days in the trip’s calendar', () => {
    const stay = { day: '2026-12-11', end: '2026-12-18' }
    expect(match(stay, { when: ['today'] })).toBe(true)
    expect(match({ day: '2026-12-16' }, { when: ['soon'] })).toBe(true)
    expect(match({ day: '2026-12-17' }, { when: ['soon'] })).toBe(false)
    expect(match({ day: '2026-12-13' }, { when: ['past'] })).toBe(true)
    expect(match({}, { when: ['upcoming'] })).toBe(false)
  })

  it('finds bookings that are late or due soon', () => {
    expect(match({ status: 'required', deadline: '2026-12-01' }, { due: ['overdue'] })).toBe(true)
    expect(match({ status: 'required', deadline: '2026-12-20' }, { due: ['soon'] })).toBe(true)
    expect(match({ status: 'booked', deadline: '2026-12-01' }, { due: ['overdue'] })).toBe(false)
    expect(match({ status: 'required' }, { due: ['none'] })).toBe(true)
  })

  it('flags what needs attention', () => {
    expect(match({ conflict: 'open' }, { focus: ['attention'] })).toBe(true)
    expect(match({ conflict: 'overridden' }, { focus: ['attention'] })).toBe(false)
    expect(match({ status: 'required', deadline: '2026-12-19' }, { focus: ['attention'] })).toBe(true)
  })

  it('finds issues by kind', () => {
    expect(match({ issues: ['item.unassigned'] }, { issue: ['any'] })).toBe(true)
    expect(match({ issues: ['item.unassigned'] }, { issue: ['people'] })).toBe(true)
    expect(match({ issues: ['booking.cost'] }, { issue: ['people', 'clash'] })).toBe(false)
    expect(match({}, { issue: ['any'] })).toBe(false)
  })

  it('searches every word, ignoring case and accents', () => {
    expect(match({ text: fold('Kyōto Station') }, {}, 'kyoto st')).toBe(true)
    expect(match({}, {}, 'tram bus')).toBe(false)
  })

  it('still follows the people lens', () => {
    const lens: FilterState = { ...state({}), lens: { people: ['b'], mode: 'any' } }
    expect(matchesFacts(base, ['a'], lens, today)).toBe(false)
  })
})
