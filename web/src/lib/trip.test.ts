import type { TripExport } from '@taac/core'
import { describe, expect, it } from 'vitest'

import { ideaArea } from './trip'

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
