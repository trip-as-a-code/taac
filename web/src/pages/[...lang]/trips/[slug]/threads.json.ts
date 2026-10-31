// Where each of the trip's discussions hangs, by anchor: its title and page,
// and the members' names by GitHub login, for notifications to name and link
// what happened (in the bell and in browser notifications).

import type { APIRoute } from 'astro'

import { tripPage, tripPaths } from '@/lib/paths'
import { threadTargets } from '@/lib/threads'

export const getStaticPaths = tripPaths

export const GET: APIRoute = ({ params, props }) => {
  const { i18n, trip } = tripPage(params, props as Parameters<typeof tripPage>[1])
  const people = Object.fromEntries(trip.members.filter((m) => m.github).map((m) => [m.github!.toLowerCase(), m.name]))
  return Response.json({ title: trip.title, targets: threadTargets(trip, i18n), people })
}
