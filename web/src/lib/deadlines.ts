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
  ladder: 'full' | 'light' | 'payment' | 'opens'
  /** Can't be booked before this: a day where the trip is, or an RFC 3339 time. */
  opens?: string
  /** A task ticked on the site is done: the tick's item, whether each person ticks their own, and whose member id each login is. */
  tick?: { item: string; each: boolean; members: Record<string, string> }
}

/** A task's tick on the site, in the packing ticks: `task-<id>`, per member or `_` for everyone. */
export const taskTickItem = (id: string) => `task-${id}`
export const SHARED_TICK = '_'

const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export function deadlines(trip: TripExport): Deadline[] {
  const github = new Map(trip.members.filter((m) => m.github).map((m) => [m.id, m.github!.toLowerCase()]))
  const memberOf = (members: string[]) =>
    Object.fromEntries(members.flatMap((id) => (github.has(id) ? [[github.get(id)!, id]] : [])))
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

  // A booking still to make that can't be made yet: its ladder waits for it to
  // open, and another says the day before and as it opens.
  const booking = (
    d: Omit<Deadline, 'logins' | 'kind' | 'ladder'> & { ladder?: Deadline['ladder'] },
    members: string[],
    opens?: string,
  ) => {
    if (opens)
      add(
        { key: `${d.key}:opens`, kind: 'booking', anchor: d.anchor, date: opens.slice(0, 10), opens, ladder: 'opens' },
        members,
      )
    if (d.date) add({ ladder: 'full', ...d, kind: 'booking', ...(opens ? { opens } : {}) }, members)
  }

  for (const task of trip.tasks) {
    const date = task.done ? undefined : (task.due ?? (task.required ? trip.startDate : undefined))
    if (!date) continue
    // Before the trip, it matters until the trip starts; during it, until it ends.
    const until = trip.startDate && date < trip.startDate ? trip.startDate : (trip.endDate ?? plusDays(date, 7))
    add(
      {
        key: `task:${task.id}`,
        kind: 'task',
        anchor: `task:${task.id}`,
        date,
        until,
        ladder: 'full',
        tick: { item: taskTickItem(task.id), each: task.each, members: memberOf(task.members) },
      },
      task.members,
    )
  }
  for (const item of trip.items) {
    const anchor = `item:${item.id}`
    // A booking matters until the day it is for.
    const until = item.local.date
    if (item.bookings?.length)
      item.bookings.forEach((b, index) => {
        if (b.status === 'required')
          booking({ key: `booking:${anchor}:${index}`, anchor, date: b.deadline ?? '', until }, b.members, b.opens)
      })
    else if (item.booking.status === 'required')
      booking(
        { key: `booking:${anchor}`, anchor, date: item.booking.deadline ?? '', until },
        item.members,
        item.booking.opens,
      )
    payments(anchor, item.costs)
  }
  for (const pass of trip.passes) {
    const anchor = `pass:${pass.id}`
    pass.shares.forEach((share, index) => {
      const until = share.periods.map((p) => p.from).sort()[0]
      if (share.status === 'required')
        booking(
          { key: `booking:${anchor}:${index}`, anchor, date: share.deadline ?? '', until },
          share.members,
          share.opens,
        )
      payments(anchor, share.costs, `${anchor}:${index}`)
    })
  }
  // An idea whose choice plans settled is not going to be booked.
  const settled = new Set(trip.choices.filter((c) => c.settledBy.length >= c.pick).map((c) => c.id))
  for (const idea of trip.ideas)
    if (idea.booking?.status === 'required' && !(idea.choice && settled.has(idea.choice)))
      booking(
        {
          key: `booking:idea:${idea.id}`,
          anchor: `idea:${idea.id}`,
          date: idea.booking.deadline ?? '',
          ladder: 'light',
        },
        idea.members,
        idea.booking.opens,
      )
  return out
}

/** The instant booking opens: a day opens at midnight where the trip is. */
export function opensAt(opens: string, timeZone: string): Date {
  if (opens.length !== 10) return new Date(opens)
  const wall = Date.parse(`${opens}T00:00:00Z`)
  const shown = (at: number) =>
    Date.parse(
      new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .format(at)
        .replace(' ', 'T') + ':00Z',
    )
  const guess = wall - (shown(wall) - wall)
  return new Date(wall - (shown(guess) - guess))
}
