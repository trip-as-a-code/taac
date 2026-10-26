// "Since your last visit": the time of this browser's previous visit to a
// trip, kept for the whole browsing session so every page highlights the
// same changes, then moved on for the next session.

/** ISO time of the last visit before this session; undefined on the first. */
export function sinceLastVisit(slug: string): string | undefined {
  const session = `taac:seen-before:${slug}`
  const lasting = `taac:seen:${slug}`
  try {
    const kept = sessionStorage.getItem(session)
    if (kept !== null) return kept || undefined
    const before = localStorage.getItem(lasting) ?? ''
    sessionStorage.setItem(session, before)
    localStorage.setItem(lasting, new Date().toISOString())
    return before || undefined
  } catch {
    return undefined
  }
}
