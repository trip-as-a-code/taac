import type { APIRoute } from 'astro'

import { localized } from '@/i18n'
import { site } from '@/lib/build'

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: localized(site.site.title, 'en'),
      short_name: localized(site.site.title, 'en'),
      description: localized(site.site.description, 'en'),
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f5f5f7',
      theme_color: '#f5f5f7',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icons/maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  )
