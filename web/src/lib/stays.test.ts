import { describe, expect, it } from 'vitest'

import { placesOf, stayRuns, type DayStay } from './stays'

const everyone = ['r', 's', 'm']
const days: DayStay[] = [
  { date: '2026-12-10', bases: [] },
  { date: '2026-12-11', bases: [{ title: 'Tokyo', members: everyone }] },
  { date: '2026-12-12', bases: [{ title: 'Tokyo', members: everyone }] },
  {
    date: '2026-12-13',
    bases: [
      { title: 'Nikko', members: ['r'] },
      { title: 'Tokyo', members: ['s', 'm'] },
    ],
  },
  { date: '2026-12-14', bases: [{ title: 'Tokyo', members: everyone }] },
]

describe('stays', () => {
  it('names the places most people sleep in first', () => {
    expect(placesOf(days[3]!, []).map((p) => p.title)).toEqual(['Tokyo', 'Nikko'])
    expect(placesOf(days[3]!, ['r']).map((p) => p.title)).toEqual(['Nikko'])
  })

  it('runs the days spent in one place, for the people in view', () => {
    const titles = (people: string[]) => stayRuns(days, people).map((r) => [r.titles.join(' · '), r.dates.length])
    expect(titles([])).toEqual([
      ['', 1],
      ['Tokyo', 2],
      ['Tokyo · Nikko', 1],
      ['Tokyo', 1],
    ])
    expect(titles(['s'])).toEqual([
      ['', 1],
      ['Tokyo', 4],
    ])
    expect(titles(['r'])).toEqual([
      ['', 1],
      ['Tokyo', 2],
      ['Nikko', 1],
      ['Tokyo', 1],
    ])
  })
})
