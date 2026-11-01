import { describe, expect, it } from 'vitest'

import { currentReminder, dayIn, rungs, rungTime, stillTimely, zonedTime, type Deadline } from './reminders'

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

  it('pushes early rungs only on their day, the urgent ones whenever', () => {
    const now = at('2026-11-13T12:00:00Z')
    expect(stillTimely({ rung: 14, at: at('2026-11-11T07:00:00Z') }, now)).toBe(false)
    expect(stillTimely({ rung: 14, at: at('2026-11-13T07:00:00Z') }, now)).toBe(true)
    expect(stillTimely({ rung: -1, at: at('2026-11-01T07:00:00Z') }, now)).toBe(true)
  })
})
