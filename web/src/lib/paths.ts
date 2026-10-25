import type { TripExport } from '@taac/core'

import { langParams, localeFromParam, useI18n } from '@/i18n'
import { site } from '@/lib/build'

/** `getStaticPaths` for every trip page in every locale. */
export function tripPaths() {
  return langParams().flatMap((params) =>
    site.trips.map((trip) => ({ params: { ...params, slug: trip.slug }, props: { trip } })),
  )
}

export function tripPage(params: Record<string, string | undefined>, props: { trip: TripExport }) {
  const lang = localeFromParam(params.lang)
  return { lang, i18n: useI18n(lang), trip: props.trip }
}
