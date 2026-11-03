// Where each of the trip's discussions hangs, by anchor: its title and page,
// and the members' names by GitHub login, for notifications to name and link
// what happened (in the bell and in browser notifications). Also where the
// discussions of renamed plans move to, for the server to carry them over.

import type { APIRoute } from 'astro'

import { changes } from '@/lib/build'
import { tripPage, tripPaths } from '@/lib/paths'
import { movedAnchors, threadTargets } from '@/lib/threads'

export const getStaticPaths = tripPaths

export const GET: APIRoute = ({ params, props }) => {
  const { i18n, trip } = tripPage(params, props as Parameters<typeof tripPage>[1])
  const people = Object.fromEntries(trip.members.filter((m) => m.github).map((m) => [m.github!.toLowerCase(), m.name]))
  const targets = threadTargets(trip, i18n)
  return Response.json({ title: trip.title, targets, people, moved: movedAnchors(changes[trip.slug] ?? [], targets) })
}
