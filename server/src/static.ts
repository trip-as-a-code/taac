/**
 * The built site from disk: `/a/b` serves `a/b`, `a/b.html` or (after a
 * redirect to `/a/b/`) `a/b/index.html`; anything else is the build's 404
 * page. Nothing outside the build directory is ever read.
 */

import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ics': 'text/calendar; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.beancount': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false
}

async function file(path: string, status = 200, head = false): Promise<Response> {
  const body = await readFile(path)
  return new Response(head ? null : body, {
    status,
    headers: {
      'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(body.length),
    },
  })
}

/** Inside `root`, or null for a path that would climb out of it. */
function within(root: string, path: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const resolved = normalize(join(root, decoded))
  return resolved === root || resolved.startsWith(root.endsWith(sep) ? root : root + sep) ? resolved : null
}

export async function serveStatic(root: string, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const head = request.method === 'HEAD'
  if (request.method !== 'GET' && !head) return new Response('Method not allowed\n', { status: 405 })
  const target = within(root, url.pathname)
  if (target) {
    if (url.pathname.endsWith('/')) {
      if (await isFile(join(target, 'index.html'))) return file(join(target, 'index.html'), 200, head)
    } else {
      if (await isFile(target)) return file(target, 200, head)
      if (await isFile(`${target}.html`)) return file(`${target}.html`, 200, head)
      if (await isFile(join(target, 'index.html')))
        return new Response(null, { status: 308, headers: { Location: `${url.pathname}/${url.search}` } })
    }
  }
  const notFound = join(root, '404.html')
  if (await isFile(notFound)) return file(notFound, 404, head)
  return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
