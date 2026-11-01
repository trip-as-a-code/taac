/**
 * Runs the taac server on Node. Configuration comes from the environment:
 *
 * - `TAAC_DIST`: the built site (default `web/dist`)
 * - `PORT`: where to listen (default 8080)
 * - `TAAC_PUBLIC_URL`: where the site answers (default: from each request)
 * - `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: signing in
 * - `DATABASE_URL`: Postgres for shared state (packing ticks)
 * - `TAAC_NOINDEX=true`: keep search engines out of a public site
 * - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`: browser notifications (`npx web-push generate-vapid-keys`)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { loadManifest } from './access'
import { createHandler, type Config } from './app'
import { vapidSender } from './push'
import { openStore } from './store'

const env = process.env

/** A web Request from Node's, trusting the proxy in front for scheme and host. */
function toRequest(req: IncomingMessage): Request {
  const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
    .split(',')[0]!
    .trim()
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost')
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v)
    else if (value !== undefined) headers.set(name, value)
  }
  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(req) as ReadableStream)
  return new Request(`${proto}://${host}${req.url ?? '/'}`, { method, headers, body, duplex: 'half' } as RequestInit)
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {}
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') headers[name] = value
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length) headers['set-cookie'] = cookies
  res.writeHead(response.status, headers)
  if (!response.body) return void res.end()
  for await (const chunk of Readable.fromWeb(response.body as NodeReadableStream)) res.write(chunk)
  res.end()
}

async function main(): Promise<void> {
  const dist = resolve(env.TAAC_DIST ?? 'web/dist')
  const manifest = await loadManifest(dist)
  const store = env.DATABASE_URL ? await openStore(env.DATABASE_URL) : undefined
  const config: Config = {
    dist,
    publicUrl: env.TAAC_PUBLIC_URL || undefined,
    sessionSecret: env.SESSION_SECRET || undefined,
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
    store,
    noindex: env.TAAC_NOINDEX === 'true',
    push:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? {
            publicKey: env.VAPID_PUBLIC_KEY,
            send: vapidSender({
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
              subject: env.TAAC_PUBLIC_URL || 'mailto:taac@localhost',
            }),
          }
        : undefined,
  }
  const handle = createHandler(config, manifest)
  void handle.announceChanges().catch((error: unknown) => console.error(error))
  // Reminders go out at each person's chosen minute, so look often; a look is cheap.
  const remind = () => void handle.remind().catch((error: unknown) => console.error(error))
  remind()
  setInterval(remind, 5 * 60_000).unref()
  const server = createServer((req, res) => {
    handle(toRequest(req))
      .then((response) => send(response, res))
      .catch((error: unknown) => {
        console.error(error)
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Internal error\n')
      })
  })
  const port = Number(env.PORT ?? 8080)
  server.listen(port, () =>
    console.log(
      `taac on :${port} — ${manifest.slugs.length} trip(s), access ${manifest.auth ?? 'public'}, ${store ? 'Postgres' : 'no database'}`,
    ),
  )
  const stop = () => {
    server.close(() => void store?.close().finally(() => process.exit(0)))
    setTimeout(() => process.exit(0), 10_000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
