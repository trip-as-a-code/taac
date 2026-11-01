// Who is signed in, from the server (`/api/me`): which trips they see and
// their calendar keys. A static preview without the server has no session;
// everything still works, minus the keyed calendar feeds.

export interface Me {
  login: string | null
  trips: string[]
  /** Trips whose packing list they may tick. */
  packing: string[]
  /** Trips whose discussions they may write in. */
  comments: string[]
  /** Trips whose view-only links they may see, make and revoke. */
  share: string[]
  /** The notification kinds the account turned off. */
  muted: string[]
  /** Where the account's browsers last said it is, and when it wants reminders (`HH:MM`); null until known or chosen. */
  timeZone: string | null
  remindAt: string | null
  /** The language the account chose, kept on the server; null until it chose one. */
  lang: string | null
  /** The VAPID public key to subscribe to browser notifications with, when they can be had. */
  push: string | null
  /** The view-only link this browser came by, while it works. */
  link: { trip: string; label: string; expiresAt: number | null } | null
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
