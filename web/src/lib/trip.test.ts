import type { TripExport } from '@taac/core'
import { describe, expect, it } from 'vitest'

import { areaRuns, ideaArea } from './trip'

const trip = {
  places: {
    Tokyo: { name: 'Tokyo', geo: [35.6812, 139.7671], radius: 30000 },
    Asakusa: { name: 'Asakusa', geo: [35.7148, 139.7967], radius: 2000 },
    'Tokyo Big Sight': { name: 'Tokyo Big Sight', geo: [35.62995, 139.79434] },
    'Senso-ji': { name: 'Senso-ji', geo: [35.7148, 139.7967] },
    Nikko: { name: 'Nikko', geo: [36.7199, 139.6982] },
  },
} as unknown as TripExport
const idea = (places: string[], area?: string) => ({ places, area }) as unknown as TripExport['ideas'][number]

describe('ideaArea', () => {
  it('takes the idea’s own area, else the smallest one its places lie in', () => {
    expect(ideaArea(trip, idea(['Tokyo Big Sight']))).toBe('Tokyo')
    expect(ideaArea(trip, idea(['Senso-ji']))).toBe('Asakusa')
    expect(ideaArea(trip, idea(['Tokyo Big Sight'], 'Asakusa'))).toBe('Asakusa')
    expect(ideaArea(trip, idea(['Nikko']))).toBe('')
    expect(ideaArea(trip, idea([]))).toBe('')
  })
})

describe('areaRuns', () => {
  // Like our Tokyo: everyone on the 11th to 13th, Alex & Sam alone on the 17th, everyone again on the 18th.
  const nights = [
    { date: '2026-12-11', members: ['r', 's', 'm'] },
    { date: '2026-12-12', members: ['r', 's', 'm'] },
    { date: '2026-12-13', members: ['r', 's', 'm'] },
    { date: '2026-12-17', members: ['s', 'm'] },
    { date: '2026-12-18', members: ['r', 's', 'm'] },
  ]

  it('joins nights into unbroken stretches for the people asked about', () => {
    expect(areaRuns(nights, [])).toEqual([
      { from: '2026-12-11', to: '2026-12-13' },
      { from: '2026-12-17', to: '2026-12-18' },
    ])
    // robin was away on the 17th: the 18th stands alone.
    expect(areaRuns(nights, ['r'])).toEqual([
      { from: '2026-12-11', to: '2026-12-13' },
      { from: '2026-12-18', to: '2026-12-18' },
    ])
    expect(areaRuns(nights, ['nobody'])).toEqual([])
  })
})
