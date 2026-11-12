import type { TripExport } from '@taac/core'
import { describe, expect, it } from 'vitest'

import { deadlines } from './deadlines'

const cost = (extra: object) => ({
  amount: 10,
  currency: 'EUR',
  paidBy: [],
  who: ['a', 'b'],
  estimate: false,
  unpaid: true,
  each: false,
  settled: true,
  ...extra,
})

const trip = {
  startDate: '2026-12-10',
  endDate: '2027-01-13',
  members: [
    { id: 'a', name: 'A', github: 'Alice' },
    { id: 'b', name: 'B', github: 'bob' },
    { id: 'c', name: 'C' },
  ],
  tasks: [
    { id: 'vjw', title: 'VJW', members: ['a', 'b'], required: false, due: '2026-11-29' },
    { id: 'visa', title: 'Visa', members: ['b'], required: true },
    { id: 'done', title: 'Done', members: ['a'], required: true, due: '2026-10-01', done: '2026-09-30' },
    { id: 'someday', title: 'Someday', members: ['a'], required: false },
    { id: 'nobody', title: 'Nobody', members: ['c'], required: false, due: '2026-11-01' },
  ],
  items: [
    {
      id: 'tower',
      local: { date: '2026-12-20' },
      members: ['a', 'b'],
      booking: { status: 'required', deadline: '2026-11-25', hasReference: false },
      costs: [
        cost({ due: '2026-12-05', paidBy: ['a'] }),
        cost({ due: '2026-12-05', charged: { amount: 9, currency: 'EUR' } }),
      ],
    },
    {
      id: 'split',
      local: { date: '2026-12-12' },
      members: ['a', 'b'],
      booking: { status: 'required', hasReference: false },
      bookings: [
        { status: 'booked', deadline: '2026-11-01', members: ['a'], costs: [], hasReference: true },
        { status: 'required', deadline: '2026-11-20', members: ['b'], costs: [], hasReference: false },
      ],
      costs: [],
    },
  ],
  passes: [
    {
      id: 'jr',
      shares: [
        {
          members: ['a'],
          periods: [{ from: '2026-12-15', to: '2026-12-21' }],
          status: 'required',
          deadline: '2026-12-01',
          costs: [],
        },
      ],
    },
  ],
  choices: [{ id: 'dinner', name: 'Dinner', pick: 1, settledBy: ['tower'] }],
  ideas: [
    {
      id: 'sushi',
      choice: 'dinner',
      members: ['a'],
      booking: { status: 'required', deadline: '2026-11-30', hasReference: false },
    },
    {
      id: 'teamlab',
      members: ['a', 'b'],
      booking: { status: 'required', deadline: '2026-11-30', hasReference: false },
    },
  ],
} as unknown as TripExport

describe('deadlines', () => {
  it('lists what is due for people who sign in, until it no longer matters', () => {
    expect(deadlines(trip)).toEqual([
      {
        key: 'task:vjw',
        kind: 'task',
        anchor: 'task:vjw',
        date: '2026-11-29',
        until: '2026-12-10',
        ladder: 'full',
        logins: ['alice', 'bob'],
        tick: { item: 'task-vjw', each: undefined, members: { alice: 'a', bob: 'b' } },
      },
      {
        key: 'task:visa',
        kind: 'task',
        anchor: 'task:visa',
        date: '2026-12-10',
        until: '2027-01-13',
        ladder: 'full',
        logins: ['bob'],
        tick: { item: 'task-visa', each: undefined, members: { bob: 'b' } },
      },
      {
        key: 'booking:item:tower',
        kind: 'booking',
        anchor: 'item:tower',
        date: '2026-11-25',
        until: '2026-12-20',
        ladder: 'full',
        logins: ['alice', 'bob'],
      },
      {
        key: 'payment:item:tower:0',
        kind: 'payment',
        anchor: 'item:tower',
        date: '2026-12-05',
        until: '2026-12-12',
        ladder: 'payment',
        logins: ['alice'],
      },
      {
        key: 'booking:item:split:1',
        kind: 'booking',
        anchor: 'item:split',
        date: '2026-11-20',
        until: '2026-12-12',
        ladder: 'full',
        logins: ['bob'],
      },
      {
        key: 'booking:pass:jr:0',
        kind: 'booking',
        anchor: 'pass:jr',
        date: '2026-12-01',
        until: '2026-12-15',
        ladder: 'full',
        logins: ['alice'],
      },
      {
        key: 'booking:idea:teamlab',
        kind: 'booking',
        anchor: 'idea:teamlab',
        date: '2026-11-30',
        ladder: 'light',
        logins: ['alice', 'bob'],
      },
    ])
  })
})
