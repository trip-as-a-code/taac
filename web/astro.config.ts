import { defineConfig } from 'astro/config'

import { taac } from './src/integrations/taac'

export default defineConfig({
  // Static output only: the worker in front adds access control at the edge.
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
    // Dev/preview run behind Coder's per-port subdomain proxy too.
    server: { allowedHosts: ['localhost', 'localhost'] },
    preview: { allowedHosts: ['localhost', 'localhost'] },
  },
})
