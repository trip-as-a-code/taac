/** `/api/fx`: ECB rates via Frankfurter, edge-cached so browsers never call a third party. */

const UPSTREAM = 'https://api.frankfurter.dev/v2/rates'
const TTL_SECONDS = 6 * 60 * 60
const CODE = /^[A-Z]{3}$/

export interface FxQuery {
  base: string
  quotes: string[]
}

export function parseFxQuery(url: URL): FxQuery | null {
  const base = url.searchParams.get('base') ?? ''
  const quotes = (url.searchParams.get('quotes') ?? '').split(',').filter(Boolean)
  if (!CODE.test(base) || quotes.length === 0 || quotes.length > 16) return null
  if (!quotes.every((q) => CODE.test(q))) return null
  return { base, quotes: [...new Set(quotes)].sort() }
}

interface UpstreamRate {
  date: string
  base: string
  quote: string
  rate: number
}

export function shapeRates(
  base: string,
  upstream: UpstreamRate[],
): { date: string | null; base: string; rates: Record<string, number> } {
  const rates: Record<string, number> = {}
  let date: string | null = null
  for (const row of upstream) {
    if (typeof row.rate !== 'number' || !CODE.test(row.quote)) continue
    rates[row.quote] = row.rate
    if (!date || row.date > date) date = row.date
  }
  return { date, base, rates }
}

function json(body: unknown, status: number, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  })
}

export async function handleFx(url: URL, ctx: ExecutionContext): Promise<Response> {
  const query = parseFxQuery(url)
  if (!query) return json({ error: 'expected ?base=XXX&quotes=YYY[,ZZZ]' }, 400)

  const cacheKey = new Request(`https://fx.taac.internal/${query.base}/${query.quotes.join(',')}`)
  const cache = (caches as unknown as { default: Cache }).default
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  try {
    const upstream = await fetch(`${UPSTREAM}?base=${query.base}&quotes=${query.quotes.join(',')}&providers=ECB`, {
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502)
    const rows = (await upstream.json()) as UpstreamRate[]
    if (!Array.isArray(rows)) return json({ error: 'unexpected upstream response' }, 502)
    const response = json(shapeRates(query.base, rows), 200, `public, max-age=${TTL_SECONDS}`)
    ctx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  } catch {
    return json({ error: 'upstream unreachable' }, 502)
  }
}
