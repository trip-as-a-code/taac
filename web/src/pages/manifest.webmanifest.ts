import type { APIRoute } from 'astro'

import { site } from '@/lib/build'

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: site.site.title,
      short_name: site.site.title,
      description: site.site.description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f5f5f7',
      theme_color: '#f5f5f7',
      icons: [
        { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icons/maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json' } },
  )
