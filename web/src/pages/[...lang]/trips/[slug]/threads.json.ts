// Where each of the trip's discussions hangs, by anchor: its title and page,
// for the notification center to name and link what happened.

import type { APIRoute } from 'astro'

import { tripPage, tripPaths } from '@/lib/paths'
import { threadTargets } from '@/lib/threads'

export const getStaticPaths = tripPaths

export const GET: APIRoute = ({ params, props }) => {
  const { i18n, trip } = tripPage(params, props as Parameters<typeof tripPage>[1])
  return Response.json({ title: trip.title, targets: threadTargets(trip, i18n) })
}
