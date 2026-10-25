import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { exportSite, type Diagnostic, type SiteExport } from '@taac/core'
import type { AstroIntegration } from 'astro'
import type { Plugin, ViteDevServer } from 'vite'

const VIRTUAL = 'virtual:taac/site'
const RESOLVED = '\0' + VIRTUAL

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

/** The data each page imports, as a virtual module so dev reloads it on change. */
function dataPlugin(onLoad: (site: SiteExport) => void): Plugin {
  let server: ViteDevServer | undefined
  let watched = new Set<string>()
  return {
    name: 'taac-data',
    configureServer(s) {
      server = s
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
      return id === VIRTUAL ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return
      const { site, paths } = load()
      watched = new Set(paths.map((p) => resolve(p)))
      server?.watcher.add([...watched, dirname(sitePath())])
      onLoad(site)
      return `export default ${JSON.stringify(site)}`
    },
  }
}

/**
 * Wires trips into Astro: the `virtual:taac/site` module for pages and
 * `/_taac/access.json` for the worker (which paths need which password).
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
          site: site.site.passwordSecret ? { secret: site.site.passwordSecret } : null,
          trips: Object.fromEntries(
            site.trips
              .filter((t) => t.passwordSecret)
              .map((t) => [t.slug, { secret: t.passwordSecret, title: t.title }]),
          ),
          locales: ['en', 'ru'],
          defaultLocale: 'en',
        }
        const out = fileURLToPath(new URL('_taac/access.json', dir))
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, JSON.stringify(access, null, 2))
        const warnings = [...site.diagnostics, ...site.trips.flatMap((t) => t.diagnostics)]
        if (warnings.length) logger.warn(`\n${format(warnings)}`)
        logger.info(`${site.trips.length} trip(s); access: ${access.site ? 'site password' : 'public'}`)
      },
    },
  }
}
