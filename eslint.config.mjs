import js from '@eslint/js'
import astro from 'eslint-plugin-astro'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist', '**/.astro', '**/node_modules', 'packages/core/pkg', 'target', '**/.wrangler'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts,mts}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
)
