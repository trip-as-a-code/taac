import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { exportSite, type Diagnostic, type Rates, type SiteExport } from '@taac/core'
import type { AstroIntegration } from 'astro'
import type { Plugin, ViteDevServer } from 'vite'

import { photoIndex } from '../lib/photos'
import { tripChanges } from './history'

const VIRTUAL = 'virtual:taac/site'
const RESOLVED = '\0' + VIRTUAL
const RATES = 'virtual:taac/rates'
const RATES_RESOLVED = '\0' + RATES
const CHANGES = 'virtual:taac/changes'
const CHANGES_RESOLVED = '\0' + CHANGES

/**
 * ECB reference rates at build time: the fallback until the page fetches
 * today's through the worker. A build without network still works; prices
 * then show in their own currency.
 */
async function fetchRates(): Promise<Rates | null> {
  try {
    const response = await fetch('https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB', {
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const rows = (await response.json()) as { date: string; quote: string; rate: number }[]
    return {
      date: rows[0]?.date ?? '',
      rates: { EUR: 1, ...Object.fromEntries(rows.map((r) => [r.quote, r.rate])) },
    }
  } catch (error) {
    const cause = error instanceof Error ? ((error.cause as Error | undefined)?.message ?? error.message) : error
    console.warn(`[taac] no exchange rates (${String(cause)}): prices show in their own currency`)
    return null
  }
}

/** The site file to render: `TAAC_SITE`, else the bundled demo. */
export function sitePath(): string {
  const fromEnv = process.env.TAAC_SITE
  return fromEnv
    ? resolve(process.env.INIT_CWD ?? process.cwd(), fromEnv)
    : fileURLToPath(new URL('../../../examples/demo/site.yaml', import.meta.url))
}

function format(diagnostics: Diagnostic[]): string {
  return diagnostics
    .map((d) => `${d.severity}[${d.code}] ${[d.file, d.trip, d.item].filter(Boolean).join(' › ')}: ${d.message}`)
    .join('\n')
}

function load(): { site: SiteExport; paths: string[] } {
  const result = exportSite(sitePath())
  if (!result.ok) {
    throw new Error(`taac: ${sitePath()} has errors\n${format(result.diagnostics)}`)
  }
  return { site: result.export, paths: result.paths }
}

/** Map from public URL path (`/vaults/<id>.kdbx` or `/trips/<slug>/vault.kdbx`) to source disk path. */
function vaultFiles(site: SiteExport): Map<string, string> {
  const base = dirname(sitePath())
  const out = new Map<string, string>()
  for (const v of site.site.vaults ?? []) {
    out.set(v.url, resolve(base, v.path))
  }
  for (const t of site.trips) {
    if (t.vault) out.set(t.vault.url, resolve(base, t.vault.path))
  }
  return out
}

/** The data each page imports, as a virtual module so dev reloads it on change. */
function dataPlugin(onLoad: (site: SiteExport) => void): Plugin {
  let server: ViteDevServer | undefined
  let rates: Promise<Rates | null> | undefined
  let changes: ReturnType<typeof tripChanges> | undefined
  let watched = new Set<string>()
  let vaults = new Map<string, string>()
  return {
    name: 'taac-data',
    configureServer(s) {
      server = s
      s.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?')[0]
        const file = pathname ? vaults.get(pathname) : undefined
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-store')
        res.end(readFileSync(file))
      })
      const reload = (file: string) => {
        if (!watched.has(resolve(file))) return
        const mod = s.moduleGraph.getModuleById(RESOLVED)
        if (mod) s.moduleGraph.invalidateModule(mod)
        s.ws.send({ type: 'full-reload' })
      }
      s.watcher.on('change', reload)
      s.watcher.on('add', reload)
      s.watcher.on('unlink', reload)
    },
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED
      if (id === RATES) return RATES_RESOLVED
      if (id === CHANGES) return CHANGES_RESOLVED
      return undefined
    },
    async load(id) {
      if (id === RATES_RESOLVED) {
        rates ??= fetchRates()
        const fetched = await rates
        // A failed fetch is tried again on the next load, not kept for the
        // dev server's lifetime.
        if (!fetched) rates = undefined
        return `export default ${JSON.stringify(fetched)}`
      }
      if (id === CHANGES_RESOLVED) {
        // Replays git history once per build (and once per dev server).
        changes ??= tripChanges(sitePath(), load().site)
        return `export default ${JSON.stringify(await changes)}`
      }
      if (id !== RESOLVED) return
      const { site, paths } = load()
      vaults = vaultFiles(site)
      watched = new Set([...paths.map((p) => resolve(p)), ...vaults.values()])
      server?.watcher.add([...watched, dirname(sitePath())])
      onLoad(site)
      return `export default ${JSON.stringify(site)}`
    },
  }
}

/**
 * Wires trips into Astro: the `virtual:taac/site` module for pages and
 * `/_taac/access.json` for the server (who may see which trip).
 */
export function taac(): AstroIntegration {
  let latest: SiteExport | undefined
  return {
    name: 'taac',
    hooks: {
      'astro:config:setup': ({ updateConfig, logger }) => {
        logger.info(`site: ${sitePath()}`)
        updateConfig({ vite: { plugins: [dataPlugin((site) => (latest = site))] } })
      },
      'astro:build:done': ({ dir, logger }) => {
        const site = latest ?? load().site
        const access = {
          // The login page localizes the site title itself.
          title: site.site.title,
          auth: site.site.access === 'github' ? 'github' : null,
          vaults: Object.fromEntries((site.site.vaults ?? []).map((v) => [v.id, { ownerLogins: v.ownerLogins ?? [] }])),
          trips: Object.fromEntries(
            site.trips.map((t) => [
              t.slug,
              {
                title: t.title,
                public: t.public,
                logins: t.logins,
                roles: Object.fromEntries(
                  t.members.flatMap((m) => (m.github ? [[m.github.toLowerCase(), m.role]] : [])),
                ),
                ...(t.vault ? { vault: { share: t.vault.share, viewers: t.vault.viewers } } : {}),
              },
            ]),
          ),
          // Every trip: the server serves shared state only for these.
          slugs: site.trips.map((t) => t.slug),
          locales: ['en', 'ru'],
          defaultLocale: 'en',
        }
        const out = fileURLToPath(new URL('_taac/access.json', dir))
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, JSON.stringify(access, null, 2))
        // Copy configured KeePass (.kdbx) vaults into dist for static & server serving.
        for (const [urlPath, src] of vaultFiles(site)) {
          if (!existsSync(src)) {
            logger.warn(`[taac] vault file not found: ${src}`)
            continue
          }
          const dest = fileURLToPath(new URL(urlPath.replace(/^\//, ''), dir))
          mkdirSync(dirname(dest), { recursive: true })
          copyFileSync(src, dest)
        }
        // Places' photos for the server to fetch and serve (lib/photos).
        writeFileSync(fileURLToPath(new URL('_taac/photos.json', dir)), JSON.stringify(photoIndex(site.trips), null, 2))
        const warnings = [...site.diagnostics, ...site.trips.flatMap((t) => t.diagnostics)]
        if (warnings.length) logger.warn(`\n${format(warnings)}`)
        logger.info(`${site.trips.length} trip(s); access: ${access.auth ?? 'public'}`)
      },
    },
  }
}
