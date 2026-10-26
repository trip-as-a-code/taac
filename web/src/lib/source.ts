// Links from what the site shows back to the line in the trip files that
// says it, when the site names its repository (`source:` in site.yaml).

import type { Source } from '@taac/core'

import { site } from '@/lib/build'

export function sourceHref(source?: Source): string | undefined {
  const repo = site.site.source
  if (!repo || !source) return undefined
  const path = [repo.dir.replace(/^\/|\/$/g, ''), source.file].filter(Boolean).join('/')
  return `${repo.repo.replace(/\/$/, '')}/blob/${repo.branch}/${path}#L${source.line}`
}

/** `itinerary.yaml:66` */
export const sourceLabel = (source: Source) => `${source.file.split('/').pop()}:${source.line}`
