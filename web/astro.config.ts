import { defineConfig } from 'astro/config'

import { taac } from './src/integrations/taac'

const extraAllowedHosts = (process.env.TAAC_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)
const allowedHosts = ['localhost', ...extraAllowedHosts]

export default defineConfig({
  // Static output only: the server in front adds access control at the edge.
  output: 'static',
  trailingSlash: 'ignore',
  i18n: {
    locales: ['en', 'ru'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  devToolbar: { enabled: false },
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  integrations: [taac()],
  vite: {
    // MapLibre's worker is an ES module.
    worker: { format: 'es' },
    // Pre-bundle the map up front, so a dev server never serves a stale copy.
    optimizeDeps: { include: ['maplibre-gl'] },
    // Additional dev/preview hosts can be whitelisted via TAAC_ALLOWED_HOSTS (comma-separated).
    server: { allowedHosts },
    preview: { allowedHosts },
  },
})
