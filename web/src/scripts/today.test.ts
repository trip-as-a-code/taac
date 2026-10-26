import { describe, expect, it } from 'vitest'

import { todayView, tripDate, type TodayData } from './today'

const item = (id: string, start: string, end: string | undefined, members = ['a', 'b']) => ({
  id,
  title: id,
  kind: 'activity',
  start,
  end,
  members,
  href: `#${id}`,
})

const data: TodayData = {
  timezone: 'Asia/Tokyo',
  days: [
    {
      n: 1,
      date: '2026-12-23',
      items: [
        item('temple', '2026-12-23T09:00:00+09:00', '2026-12-23T11:00:00+09:00'),
        item('lunch', '2026-12-23T12:00:00+09:00', undefined, ['b']),
        item('onsen', '2026-12-23T18:00:00+09:00', '2026-12-23T20:00:00+09:00', ['a']),
      ],
      stays: [
        { title: 'Ryokan', members: ['a'], href: '#r' },
        { title: 'Flat', members: ['b'], href: '#f' },
      ],
      present: ['a', 'b'],
    },
    {
      n: 2,
      date: '2026-12-24',
      items: [item('train', '2026-12-24T08:00:00+09:00', undefined, ['b'])],
      stays: [],
      present: ['a', 'b'],
    },
  ],
}

describe('today', () => {
  it('reads the date where the trip is', () => {
    expect(tripDate('Asia/Tokyo', new Date('2026-12-22T16:00:00Z'))).toBe('2026-12-23')
  })

  it('splits the day into done, now and next', () => {
    const view = todayView(data, '2026-12-23', [], Date.parse('2026-12-23T10:00:00+09:00'))!
    expect(view.now.map((i) => i.id)).toEqual(['temple'])
    expect(view.next.map((i) => i.id)).toEqual(['lunch', 'onsen'])
    expect(view.done).toBe(0)
  })

  it('counts a plan without an end as an hour long', () => {
    const view = todayView(data, '2026-12-23', [], Date.parse('2026-12-23T13:30:00+09:00'))!
    expect(view.done).toBe(2)
    expect(view.next.map((i) => i.id)).toEqual(['onsen'])
  })

  it('follows the people lens, tomorrow included', () => {
    const view = todayView(data, '2026-12-23', ['a'])!
    expect(view.next.map((i) => i.id)).toEqual(['temple', 'onsen'])
    expect(view.stays.map((s) => s.title)).toEqual(['Ryokan'])
    expect(view.tomorrow).toBeUndefined()
    expect(todayView(data, '2026-12-23', ['b'])!.tomorrow?.id).toBe('train')
  })

  it('has nothing outside the trip', () => {
    expect(todayView(data, '2027-02-01', [])).toBeUndefined()
  })
})
