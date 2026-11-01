import { describe, expect, it } from 'vitest'

import { placeHue, placeHues, placesOf, splitBar, stayRuns, type DayStay } from './stays'

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
    expect(placesOf(days[3]!, [])).toEqual([
      { title: 'Tokyo', members: ['s', 'm'] },
      { title: 'Nikko', members: ['r'] },
    ])
    expect(placesOf(days[3]!, ['r'])).toEqual([{ title: 'Nikko', members: ['r'] }])
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

  it('keeps places apart in colour, however many there are', () => {
    // These two hash 7° apart.
    expect(Math.abs(placeHue('Киото') - placeHue('Осака'))).toBeLessThan(10)
    const titles = ['Киото', 'Осака', 'Tokyo', 'Nikko', 'Sapporo', 'Fukuoka']
    const hues = Object.values(placeHues(titles))
    for (const [i, a] of hues.entries())
      for (const b of hues.slice(i + 1))
        expect(Math.min(Math.abs(a - b), 360 - Math.abs(a - b))).toBeGreaterThanOrEqual(36)
  })

  it("shares a split stay's bar by head count, for any number of places", () => {
    const bar = splitBar(
      { titles: ['A', 'B', 'C'], who: [['1', '2'], ['3'], ['4']], dates: [] },
      { A: 10, B: 120, C: 240 },
    )
    expect(bar).toBe(
      'linear-gradient(to right, hsl(10 70% 55%) 0% 50%, hsl(120 70% 55%) 50% 75%, hsl(240 70% 55%) 75% 100%)',
    )
  })
})
