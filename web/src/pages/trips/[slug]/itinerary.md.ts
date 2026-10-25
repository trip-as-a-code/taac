import type { APIRoute, GetStaticPaths } from 'astro'

import { site } from '@/lib/build'

export const getStaticPaths: GetStaticPaths = () =>
  site.trips.map((trip) => ({ params: { slug: trip.slug }, props: { trip } }))

export const GET: APIRoute = ({ props }) =>
  new Response(props.trip.artifacts.markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
