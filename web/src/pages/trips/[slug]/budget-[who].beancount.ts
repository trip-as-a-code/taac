import type { APIRoute, GetStaticPaths } from 'astro'

import { site } from '@/lib/build'
import { fileKey } from '@/lib/trip'

/** The ledger for each member and group, with only what they take part in. */
export const getStaticPaths: GetStaticPaths = () =>
  site.trips.flatMap((trip) =>
    Object.entries(trip.artifacts.byParty).map(([who, files]) => ({
      params: { slug: trip.slug, who: fileKey(who) },
      props: { body: files.beancount },
    })),
  )

export const GET: APIRoute = ({ props }) =>
  new Response(props.body as string, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
