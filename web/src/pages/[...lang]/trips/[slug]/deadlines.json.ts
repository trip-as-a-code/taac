// What is due on the trip and for whom, for the server to remind them: open
// tasks, bookings still to make and costs charged later. No titles: those
// come from threads.json, in each person's language.

import type { APIRoute } from 'astro'

import { deadlines } from '@/lib/deadlines'
import { tripPage, tripPaths } from '@/lib/paths'

export const getStaticPaths = tripPaths

export const GET: APIRoute = ({ params, props }) => {
  const { trip } = tripPage(params, props as Parameters<typeof tripPage>[1])
  return Response.json({ timezone: trip.timezone, deadlines: deadlines(trip) })
}
