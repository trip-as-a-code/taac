import { describe, expect, it } from 'vitest'

import {
  currentReminder,
  dayIn,
  movedDueId,
  movedKey,
  openingWords,
  rungs,
  rungTime,
  stillTimely,
  ticked,
  zonedTime,
  type Deadline,
} from './reminders'

const booking: Deadline = {
  key: 'booking:item:tower',
  kind: 'booking',
  anchor: 'item:tower',
  date: '2026-11-25',
  logins: ['alex'],
  until: '2026-12-20',
  ladder: 'full',
}
const helsinki = { timeZone: 'Europe/Helsinki', remindAt: '09:00' }
const at = (iso: string) => Date.parse(iso)

describe('reminders', () => {
  it('reads wall clocks in a time zone, across clock changes', () => {
    expect(zonedTime('2026-11-25', '09:00', 'Europe/Helsinki')).toBe(at('2026-11-25T07:00:00Z'))
    expect(zonedTime('2026-07-01', '09:00', 'Europe/Helsinki')).toBe(at('2026-07-01T06:00:00Z'))
    expect(zonedTime('2026-11-26', '00:00', 'Asia/Tokyo')).toBe(at('2026-11-25T15:00:00Z'))
    expect(dayIn(at('2026-11-25T22:30:00Z'), 'Europe/Helsinki')).toBe('2026-11-26')
  })

  it('reminds more often as a deadline nears, then weekly while it still matters', () => {
    expect(rungs(booking)).toEqual([30, 14, 7, 3, 2, 1, 0, -1, -3, -5, -7, -14, -21])
    expect(rungs({ ...booking, ladder: 'payment', until: '2026-12-02' })).toEqual([7, 3, 1, 0, -1, -7])
    expect(rungs({ ...booking, ladder: 'light', until: undefined })).toEqual([7, 1])
  })

  it('comes at their time where they are, but before the deadline ends where the trip is', () => {
    expect(rungTime(booking, 0, 'Asia/Tokyo', helsinki)).toBe(at('2026-11-25T07:00:00Z'))
    // 09:00 in California is past midnight in Tokyo: the day before instead.
    const california = { timeZone: 'America/Los_Angeles', remindAt: '09:00' }
    expect(rungTime(booking, 0, 'Asia/Tokyo', california)).toBe(at('2026-11-24T17:00:00Z'))
    // After the deadline, nothing to be early for.
    expect(rungTime(booking, -1, 'Asia/Tokyo', california)).toBe(at('2026-11-26T17:00:00Z'))
  })

  it('keeps the latest rung that has come, until the thing no longer matters', () => {
    expect(currentReminder(booking, at('2026-10-20T12:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    expect(currentReminder(booking, at('2026-11-12T12:00:00Z'), 'Asia/Tokyo', helsinki)).toEqual({
      rung: 14,
      at: at('2026-11-11T07:00:00Z'),
    })
    expect(currentReminder(booking, at('2026-11-30T12:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(-5)
    expect(currentReminder(booking, at('2026-12-21T12:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
  })

  it('waits for booking to open, then says so the day before and as it opens', () => {
    // Sold from midnight in Tokyo: 17:00 the day before in Helsinki.
    const sky = { ...booking, date: '2026-11-28', until: '2026-12-12', opens: '2026-11-28' }
    const opening: Deadline = { ...sky, key: 'booking:item:tower:opens', ladder: 'opens', until: undefined }
    expect(rungs(opening)).toEqual([1, 0])
    expect(rungTime(opening, 1, 'Asia/Tokyo', helsinki)).toBe(at('2026-11-26T07:00:00Z'))
    expect(rungTime(opening, 0, 'Asia/Tokyo', helsinki)).toBe(at('2026-11-27T15:00:00Z'))
    expect(currentReminder(opening, at('2026-11-27T16:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(0)
    // Nothing to book yet: the booking's own rungs before it opens don't remind.
    expect(currentReminder(sky, at('2026-11-27T12:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    expect(currentReminder(sky, at('2026-11-28T08:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(0)
    const timed = { ...sky, opens: '2026-11-16T13:00:00+09:00' }
    expect(currentReminder(timed, at('2026-11-16T03:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    // The two-week rung came before it opened; the opening said it, and the next rung follows.
    expect(currentReminder(timed, at('2026-11-16T05:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    expect(currentReminder(timed, at('2026-11-21T08:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(7)
    expect(openingWords(at('2026-11-27T15:00:00Z'), at('2026-11-26T07:00:00Z'), 'en', 'Europe/Helsinki')).toEqual({
      day: 'tomorrow',
      time: '17:00',
    })
  })

  it('reminds of a draw every day from when entries open, and once on its results day', () => {
    const entry: Deadline = {
      ...booking,
      key: 'booking:item:tower:entry',
      date: '2026-11-30',
      opens: '2026-11-16T13:00:00+09:00',
      ladder: 'lottery',
      lottery: 'entry',
      until: undefined,
    }
    expect(rungs(entry)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    // Before entries open nothing; the morning after, the daily rung.
    expect(currentReminder(entry, at('2026-11-16T03:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    expect(currentReminder(entry, at('2026-11-17T08:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(13)
    expect(currentReminder(entry, at('2026-12-01T12:00:00Z'), 'Asia/Tokyo', helsinki)).toBeNull()
    const results: Deadline = {
      ...booking,
      key: 'booking:item:tower:results',
      date: '2026-12-04',
      ladder: 'results',
      lottery: 'results',
      until: undefined,
    }
    expect(rungs(results)).toEqual([0])
    expect(currentReminder(results, at('2026-12-04T08:00:00Z'), 'Asia/Tokyo', helsinki)?.rung).toBe(0)
  })

  it('stops reminding of a draw for whoever has entered', () => {
    const entry: Deadline = {
      ...booking,
      ladder: 'lottery',
      tick: { item: 'entry-item-tower', each: true, members: { alex: 'a', robin: 'b' } },
    }
    const ticks = { 'entry-item-tower|a': { packed: true } }
    expect(ticked(entry, 'alex', ticks)).toBe(true)
    expect(ticked(entry, 'robin', ticks)).toBe(false)
  })

  it('pushes early rungs only on their day, the urgent ones whenever', () => {
    const now = at('2026-11-13T12:00:00Z')
    expect(stillTimely({ rung: 14, at: at('2026-11-11T07:00:00Z') }, now)).toBe(false)
    expect(stillTimely({ rung: 14, at: at('2026-11-13T07:00:00Z') }, now)).toBe(true)
    expect(stillTimely({ rung: -1, at: at('2026-11-01T07:00:00Z') }, now)).toBe(true)
  })
})

describe('renamed anchors in reminder keys', () => {
  it('moves the anchor wherever a key or notification id holds it, and only there', () => {
    expect(movedKey('task:visa', 'task:visa', 'task:japan-visa')).toBe('task:japan-visa')
    expect(movedKey('booking:item:tower:1', 'item:tower', 'item:tokyo-tower')).toBe('booking:item:tokyo-tower:1')
    expect(movedKey('payment:pass:jr:0:2', 'pass:jr', 'pass:jr-east')).toBe('payment:pass:jr-east:0:2')
    expect(movedKey('booking:item:tower-2', 'item:tower', 'item:x')).toBeNull()
    expect(movedDueId('due:booking:item:tower:2026-11-25:3', 'item:tower', 'item:tokyo-tower')).toBe(
      'due:booking:item:tokyo-tower:2026-11-25:3',
    )
    expect(movedDueId('due:task:visa:2026-11-01:-1', 'item:tower', 'item:x')).toBeNull()
  })
})
