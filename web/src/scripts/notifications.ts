// The notification center: the bell's count of what others did since you last
// looked, and the list, read from the server with the place each one links to.

import { me } from '@/scripts/session'

interface Notification {
  id: string
  trip: string
  kind: 'thread' | 'reply' | 'resolved'
  anchor: string
  thread: string
  by: string
  text: string
  at: number
}

interface Person {
  name: string
  initials: string
  hue: number
}

/** Trip titles and where each anchor is, fetched once per trip. */
const targets = new Map<
  string,
  Promise<{ title: string; targets: Record<string, { title: string; href: string }> } | null>
>()
let listening = false
/** The current page's refresh, for the one visibility listener. */
let refreshCurrent: (() => Promise<void>) | undefined

function targetsOf(base: string, trip: string) {
  let found = targets.get(trip)
  if (!found) {
    found = fetch(`${base}trips/${encodeURIComponent(trip)}/threads.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    targets.set(trip, found)
  }
  return found
}

function when(ms: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(days, 'day')
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(ms)
}

/** The page of the thing, opening its discussion there. */
function linkTo(href: string, anchor: string): string {
  const [page, hash] = href.split('#')
  return `${page}?thread=${encodeURIComponent(anchor)}${hash ? `#${hash}` : ''}`
}

export async function setupNotifications() {
  const found = document.querySelector<HTMLElement>('[data-notifications]')
  if (!found) return
  const root: HTMLElement = found
  const session = await me()
  if (!session?.login || !session.comments.length) return
  const open = root.querySelector<HTMLButtonElement>('[data-notifications-open]')!
  const panel = root.querySelector<HTMLDialogElement>('[data-notifications-panel]')!
  const list = root.querySelector<HTMLElement>('[data-notifications-list]')!
  const count = root.querySelector<HTMLElement>('[data-notifications-count]')!
  const error = root.querySelector<HTMLElement>('[data-notifications-error]')!
  const lang = root.dataset.lang!
  const base = root.dataset.base!
  const people = JSON.parse(root.dataset.people ?? '{}') as Record<string, Person>
  const s = JSON.parse(root.dataset.strings ?? '{}') as Record<string, string>
  open.hidden = false

  let items: Notification[] = []
  let seenAt = 0
  /** What was new when the panel opened: it stays marked while it is open. */
  let shownSince = 0

  async function load() {
    try {
      const response = await fetch('/api/notifications', { credentials: 'same-origin' })
      if (!response.ok) throw new Error(String(response.status))
      ;({ notifications: items, seenAt } = (await response.json()) as { notifications: Notification[]; seenAt: number })
      error.hidden = true
    } catch {
      error.textContent = s.error!
      error.hidden = false
    }
    const fresh = items.filter((n) => n.at > seenAt).length
    count.textContent = fresh ? String(fresh > 99 ? '99+' : fresh) : ''
    if (panel.open) await render()
  }

  async function render() {
    const rows = await Promise.all(
      items.map(async (n) => {
        const trip = await targetsOf(base, n.trip)
        const target = trip?.targets[n.anchor]
        const link = document.createElement('a')
        link.href = target ? linkTo(target.href, n.anchor) : `${base}trips/${encodeURIComponent(n.trip)}/`
        link.toggleAttribute('data-new', n.at > shownSince)
        const person = people[n.by]
        const avatar = document.createElement('span')
        avatar.className = 'avatar'
        avatar.style.setProperty('--hue', String(person?.hue ?? 210))
        avatar.textContent = person?.initials ?? n.by.slice(0, 1).toUpperCase()
        const img = document.createElement('img')
        img.className = 'avatar-photo'
        img.src = `/api/avatars/${n.by}`
        img.alt = ''
        img.dataset.avatarPhoto = ''
        avatar.append(img)
        const what = document.createElement('span')
        what.className = 'subhead what'
        what.textContent = s[n.kind]!.replace('{name}', person?.name ?? `@${n.by}`)
        const where = document.createElement('span')
        where.className = 'footnote secondary what'
        where.textContent = [
          target?.title,
          root.hasAttribute('data-several-trips') ? trip?.title : undefined,
          when(n.at, lang),
        ]
          .filter(Boolean)
          .join(' · ')
        link.append(avatar, what, where)
        if (n.text) {
          const text = document.createElement('span')
          text.className = 'footnote tertiary text'
          text.textContent = n.text
          link.append(text)
        }
        link.addEventListener('click', () => panel.close())
        const item = document.createElement('li')
        item.append(link)
        return item
      }),
    )
    list.replaceChildren(...rows)
    root.querySelector<HTMLElement>('[data-notifications-none]')!.hidden = items.length > 0
  }

  open.addEventListener('click', async () => {
    shownSince = seenAt
    panel.showModal()
    await render()
    // Opening the center reads it.
    if (items.some((n) => n.at > seenAt)) {
      await fetch('/api/notifications/seen', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
      seenAt = Date.now()
      count.textContent = ''
    }
  })
  root.querySelector('[data-notifications-close]')!.addEventListener('click', () => panel.close())
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.close()
  })
  if (!listening) {
    listening = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshCurrent?.()
    })
  }
  refreshCurrent = load
  await load()
}
