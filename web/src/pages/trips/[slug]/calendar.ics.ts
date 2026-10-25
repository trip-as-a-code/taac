import type { APIRoute, GetStaticPaths } from 'astro'

import { site } from '@/lib/build'

export const getStaticPaths: GetStaticPaths = () =>
  site.trips.map((trip) => ({ params: { slug: trip.slug }, props: { trip } }))

export const GET: APIRoute = ({ props }) =>
  new Response(props.trip.artifacts.ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } })
