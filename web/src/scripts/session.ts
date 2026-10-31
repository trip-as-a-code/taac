// Who is signed in, from the server (`/api/me`): which trips they see and
// their calendar keys. A static preview without the server has no session;
// everything still works, minus the keyed calendar feeds.

export interface Me {
  login: string | null
  trips: string[]
  calendars: Record<string, string>
}

let pending: Promise<Me | null> | undefined

export function me(): Promise<Me | null> {
  pending ??= fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
    .catch(() => null)
  return pending
}

/** Marks the page signed in, hides the trips they can't open, and keys calendar links. */
export async function applySession(): Promise<void> {
  const session = await me()
  if (!session) return
  document.documentElement.toggleAttribute('data-auth', Boolean(session.login))
  if (session.login)
    for (const card of document.querySelectorAll<HTMLElement>('[data-trip-card]'))
      card.hidden = !session.trips.includes(card.dataset.tripCard!)
  for (const link of document.querySelectorAll<HTMLElement>('[data-calendar-feed]')) {
    const key = session.calendars[link.dataset.calendarFeed!]
    if (key) link.dataset.calendarKey = key
  }
  document.dispatchEvent(new CustomEvent('taac:session'))
}
