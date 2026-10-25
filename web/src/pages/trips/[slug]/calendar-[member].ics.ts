import type { APIRoute, GetStaticPaths } from 'astro'

import { site } from '@/lib/build'

/** One calendar per person, with only the plans they take part in. */
export const getStaticPaths: GetStaticPaths = () =>
  site.trips.flatMap((trip) =>
    Object.entries(trip.artifacts.icsByMember).map(([member, ics]) => ({
      params: { slug: trip.slug, member },
      props: { ics },
    })),
  )

export const GET: APIRoute = ({ props }) =>
  new Response(props.ics as string, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } })
