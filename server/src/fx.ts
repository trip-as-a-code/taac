/** `/api/fx`: ECB rates via Frankfurter, cached here so browsers never call a third party. */

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

function json(body: string, status: number, cacheControl = 'no-store'): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheControl },
  })
}

/** Answers by query, kept for the TTL; a failed fetch isn't kept. */
const cache = new Map<string, { body: string; until: number }>()

export async function handleFx(url: URL, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const query = parseFxQuery(url)
  if (!query) return json(JSON.stringify({ error: 'expected ?base=XXX&quotes=YYY[,ZZZ]' }), 400)

  const key = `${query.base}/${query.quotes.join(',')}`
  const hit = cache.get(key)
  if (hit && hit.until > now) return json(hit.body, 200, `public, max-age=${Math.round((hit.until - now) / 1000)}`)

  try {
    const upstream = await fetcher(`${UPSTREAM}?base=${query.base}&quotes=${query.quotes.join(',')}&providers=ECB`, {
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) return json(JSON.stringify({ error: `upstream ${upstream.status}` }), 502)
    const rows = (await upstream.json()) as UpstreamRate[]
    if (!Array.isArray(rows)) return json(JSON.stringify({ error: 'unexpected upstream response' }), 502)
    const body = JSON.stringify(shapeRates(query.base, rows))
    cache.set(key, { body, until: now + TTL_SECONDS * 1000 })
    return json(body, 200, `public, max-age=${TTL_SECONDS}`)
  } catch {
    return json(JSON.stringify({ error: 'upstream unreachable' }), 502)
  }
}
