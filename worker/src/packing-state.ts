import { DurableObject } from 'cloudflare:workers'

import { merge, type Ticks } from './packing'

/** One per trip (named by its slug): holds that trip's ticks. */
export class PackingState extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const ticks = (await this.ctx.storage.get<Ticks>('ticks')) ?? {}
    if (request.method === 'POST') {
      const body = await request.json<{ changes?: unknown }>().catch(() => ({ changes: undefined }))
      if (merge(ticks, body.changes, Date.now()) > 0) await this.ctx.storage.put('ticks', ticks)
    }
    return Response.json({ ticks }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
