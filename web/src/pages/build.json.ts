import type { APIRoute } from 'astro'

import { buildId } from '@/lib/build'

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ buildId }), { headers: { 'Content-Type': 'application/json' } })
