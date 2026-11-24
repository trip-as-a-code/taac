import type { Item, TripExport } from '@taac/core'
import { describe, expect, it } from 'vitest'

import { diffTrips, renamesOf } from './changes'

const item = (id: string, over: Partial<Item> = {}): Item =>
  ({
    id,
    title: id,
    kind: 'activity',
    local: { date: '2026-12-20', time: '10:00' },
    booking: { status: 'none' },
    costs: [],
    members: ['a'],
    ...over,
  }) as Item

const trip = (items: Item[], ideas: { id: string; title: string }[] = []) => ({ items, ideas }) as unknown as TripExport

describe('diffTrips', () => {
  it('names what was added, removed and changed', () => {
    const before = trip([
      item('temple'),
      item('flight', { booking: { status: 'required' } as Item['booking'] }),
      item('old'),
    ])
    const after = trip([
      item('temple', { local: { date: '2026-12-21', time: '09:00' } }),
      item('flight', {
        booking: { status: 'booked' } as Item['booking'],
        costs: [{ amount: 300, currency: 'EUR' }] as Item['costs'],
      }),
      item('new', { kind: 'meal', local: { date: '2026-12-25' } }),
    ])
    expect(diffTrips(before, after)).toEqual([
      { kind: 'moved', id: 'temple', title: 'temple', from: '2026-12-20 10:00', to: '2026-12-21 09:00' },
      { kind: 'booked', id: 'flight', title: 'flight' },
      { kind: 'price', id: 'flight', title: 'flight', from: '', to: '300 EUR' },
      { kind: 'added', id: 'new', title: 'new' },
      { kind: 'removed', id: 'old', title: 'old' },
    ])
  })

  it('reads a new title on the same day as a rename', () => {
    const events = diffTrips(trip([item('hotel-robin')]), trip([item('hotel')]))
    expect(events).toEqual([{ kind: 'renamed', id: 'hotel', title: 'hotel', from: 'hotel-robin', to: 'hotel' }])
  })

  it('tracks ideas and who', () => {
    const events = diffTrips(
      trip([item('walk')], [{ id: 'market', title: 'Market' }]),
      trip([item('walk', { members: ['a', 'b'] })], [{ id: 'fado', title: 'Fado' }]),
    )
    expect(events.map((e) => [e.kind, e.id])).toEqual([
      ['who', 'walk'],
      ['ideaAdded', 'fado'],
      ['ideaRemoved', 'market'],
    ])
  })
})

describe('renamesOf', () => {
  it('pairs each kind of thing that lost its old id to a new title', () => {
    const before = {
      items: [item('hotel-robin')],
      ideas: [{ id: 'arcade', kind: 'activity', area: 'tokyo' }],
      tasks: [{ id: 'visa', due: '2026-11-01', required: true, members: ['a'] }],
      passes: [{ id: 'suica', area: 'tokyo', mode: 'transit' }],
      packing: [
        {
          category: 'Docs',
          items: [
            { id: 'p1', name: 'Passport' },
            { id: 'p2', name: 'Cash' },
          ],
        },
      ],
    } as unknown as TripExport
    const after = {
      items: [item('hotel')],
      ideas: [{ id: 'arcades', kind: 'activity', area: 'tokyo' }],
      tasks: [{ id: 'japan-visa', due: '2026-11-01', required: true, members: ['a'] }],
      passes: [{ id: 'suica-tokyo', area: 'tokyo', mode: 'transit' }],
      packing: [
        {
          category: 'Docs',
          items: [
            { id: 'p1', name: 'Passport' },
            { id: 'p3', name: 'Yen' },
          ],
        },
      ],
    } as unknown as TripExport
    expect(renamesOf(before, after)).toEqual([
      ['item:hotel-robin', 'item:hotel'],
      ['idea:arcade', 'idea:arcades'],
      ['task:visa', 'task:japan-visa'],
      ['pass:suica', 'pass:suica-tokyo'],
      ['packing:p2', 'packing:p3'],
    ])
  })

  it('follows an idea made a plan, and leaves the new idea that looks like it alone', () => {
    const before = {
      ...trip([]),
      ideas: [{ id: 'museum-day-2', kind: 'activity', area: 'tokyo', local: { date: '2026-12-21' } }],
    } as unknown as TripExport
    const after = {
      ...trip([item('museum-day-2', { local: { date: '2026-12-21' } } as Partial<Item>)]),
      ideas: [{ id: 'museum-day-2-tour', kind: 'activity', area: 'tokyo', local: { date: '2026-12-21' } }],
    } as unknown as TripExport
    const none = { tasks: [], passes: [], packing: [] }
    expect(renamesOf({ ...before, ...none }, { ...after, ...none })).toEqual([
      ['idea:museum-day-2', 'item:museum-day-2'],
    ])
    expect(renamesOf({ ...after, ...none }, { ...before, ...none })).toEqual([
      ['item:museum-day-2', 'idea:museum-day-2'],
    ])
  })

  it('leaves things that changed in other ways, or were swapped for something else', () => {
    const before = trip([item('a', { local: { date: '2026-12-20' } } as Partial<Item>)])
    const after = trip([item('b', { local: { date: '2026-12-21' } } as Partial<Item>)])
    expect(
      renamesOf({ ...before, tasks: [], passes: [], packing: [] }, { ...after, tasks: [], passes: [], packing: [] }),
    ).toEqual([])
  })
})
