// The trip's recent changes, worded for notifications: who (login and name),
// when, and a one-line summary in this language, linking to "Recent changes".

import type { APIRoute } from 'astro'

import { changes } from '@/lib/build'
import { tripPage, tripPaths } from '@/lib/paths'

export const getStaticPaths = tripPaths

export const GET: APIRoute = ({ params, props }) => {
  const { i18n, trip } = tripPage(params, props as Parameters<typeof tripPage>[1])
  const { t, path } = i18n
  // Sets kept only for their renames (`moves`) have nothing to tell.
  const sets = (changes[trip.slug] ?? [])
    .filter((set) => set.events.length > 0)
    .map((set) => {
      // Each thing once, by what happened to it first.
      const first = new Map<string, (typeof set.events)[number]>()
      for (const e of set.events) if (!first.has(e.id)) first.set(e.id, e)
      const distinct = [...first.values()]
      const shown = distinct
        .slice(0, 2)
        .map((e) => `${t(`changes.${e.kind}`)}: ${e.kind === 'renamed' ? e.to : e.title}`)
      if (distinct.length > 2) shown.push(t('changes.more', { n: distinct.length - 2 }))
      return {
        id: set.sha,
        login: set.login,
        author: set.author,
        at: Date.parse(set.date),
        summary: shown.join(' · '),
        href: path(`/trips/${trip.slug}/#changes`),
      }
    })
  return Response.json({ sets })
}
