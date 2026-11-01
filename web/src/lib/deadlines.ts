// Everything on a trip that is due by a date, for reminders: tasks not done
// yet (a required one is due by the start), bookings still to make (a plan's,
// each of its reservations', a pass's share, an idea's if it is chosen) and
// costs charged later whose amount isn't in yet. Each is for its people who
// sign in with GitHub, until it no longer matters.

import type { Cost, TripExport } from '@taac/core'

export interface Deadline {
  key: string
  kind: 'booking' | 'payment' | 'task'
  anchor: string
  date: string
  logins: string[]
  until?: string
  ladder: 'full' | 'light' | 'payment'
}

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export function deadlines(trip: TripExport): Deadline[] {
  const github = new Map(trip.members.filter((m) => m.github).map((m) => [m.id, m.github!.toLowerCase()]))
  const logins = (members: string[]) => [...new Set(members.flatMap((id) => github.get(id) ?? []))]
  const out: Deadline[] = []
  const add = (d: Omit<Deadline, 'logins'>, members: string[]) => {
    const people = logins(members)
    if (people.length) out.push({ ...d, logins: people })
  }
  // Charged later: a nudge for whoever pays, else whoever it's for, until the amount is in.
  const payments = (anchor: string, costs: Cost[], key = anchor) =>
    costs.forEach((cost, index) => {
      if (cost.due && !cost.charged)
        add(
          {
            key: `payment:${key}:${index}`,
            kind: 'payment',
            anchor,
            date: cost.due,
            until: plusDays(cost.due, 7),
            ladder: 'payment',
          },
          cost.paidBy.length ? cost.paidBy : cost.who,
        )
    })

  for (const task of trip.tasks) {
    const date = task.done ? undefined : (task.due ?? (task.required ? trip.startDate : undefined))
    if (!date) continue
    // Before the trip, it matters until the trip starts; during it, until it ends.
    const until = trip.startDate && date < trip.startDate ? trip.startDate : (trip.endDate ?? plusDays(date, 7))
    add({ key: `task:${task.id}`, kind: 'task', anchor: `task:${task.id}`, date, until, ladder: 'full' }, task.members)
  }
  for (const item of trip.items) {
    const anchor = `item:${item.id}`
    // A booking matters until the day it is for.
    const until = item.local.date
    if (item.bookings?.length)
      item.bookings.forEach((b, index) => {
        if (b.status === 'required' && b.deadline)
          add(
            { key: `booking:${anchor}:${index}`, kind: 'booking', anchor, date: b.deadline, until, ladder: 'full' },
            b.members,
          )
      })
    else if (item.booking.status === 'required' && item.booking.deadline)
      add(
        { key: `booking:${anchor}`, kind: 'booking', anchor, date: item.booking.deadline, until, ladder: 'full' },
        item.members,
      )
    payments(anchor, item.costs)
  }
  for (const pass of trip.passes) {
    const anchor = `pass:${pass.id}`
    pass.shares.forEach((share, index) => {
      const until = share.periods.map((p) => p.from).sort()[0]
      if (share.status === 'required' && share.deadline)
        add(
          { key: `booking:${anchor}:${index}`, kind: 'booking', anchor, date: share.deadline, until, ladder: 'full' },
          share.members,
        )
      payments(anchor, share.costs, `${anchor}:${index}`)
    })
  }
  for (const idea of trip.ideas)
    if (idea.booking?.status === 'required' && idea.booking.deadline)
      add(
        {
          key: `booking:idea:${idea.id}`,
          kind: 'booking',
          anchor: `idea:${idea.id}`,
          date: idea.booking.deadline,
          ladder: 'light',
        },
        idea.members,
      )
  return out
}
