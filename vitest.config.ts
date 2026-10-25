import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Web modules import each other through the site's `@/` alias.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('web/src', import.meta.url)) } },
})
