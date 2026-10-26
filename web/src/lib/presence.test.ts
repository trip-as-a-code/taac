import { describe, expect, it } from 'vitest'

import { shiftTime } from './presence'

describe('shiftTime', () => {
  it('moves wall times between offsets', () => {
    expect(shiftTime('16:00', '+09:00', '+02:00')).toBe('09:00')
    expect(shiftTime('24:00', '+09:00', '+02:00')).toBe('17:00')
    expect(shiftTime('09:00', '+02:00', '+09:00')).toBe('16:00')
    expect(shiftTime('17:00', '+02:00', '+09:00')).toBe('24:00')
  })
})
