// The notification center: the bell's count of what others did since you last
// looked, its list of the latest, and the full page with everything, read
// from the server with the place each one links to. Also the switch for
// browser notifications on this device.

import { pushState, turnOff, turnOn } from '@/scripts/push'
import { me, type Me } from '@/scripts/session'

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

interface Context {
  root: HTMLElement
  lang: string
  base: string
  people: Record<string, Person>
  strings: Record<string, string>
}

/** Trip titles and where each anchor is, fetched once per trip. */
const targets = new Map<
  string,
  Promise<{ title: string; targets: Record<string, { title: string; href: string }> } | null>
>()
let listening = false
/** The current page's refresh, for the one visibility listener. */
let refreshCurrent: (() => Promise<void>) | undefined

function context(): Context | null {
  const root = document.querySelector<HTMLElement>('[data-notifications]')
  if (!root) return null
  return {
    root,
    lang: root.dataset.lang!,
    base: root.dataset.base!,
    people: JSON.parse(root.dataset.people ?? '{}') as Record<string, Person>,
    strings: JSON.parse(root.dataset.strings ?? '{}') as Record<string, string>,
  }
}

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

async function fetchPage(
  limit: number,
  before?: number,
): Promise<{ notifications: Notification[]; seenAt: number; more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', String(before))
  const response = await fetch(`/api/notifications?${params}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
}

async function renderItem(n: Notification, ctx: Context, fresh: boolean): Promise<HTMLLIElement> {
  const trip = await targetsOf(ctx.base, n.trip)
  const target = trip?.targets[n.anchor]
  const link = document.createElement('a')
  link.href = target ? linkTo(target.href, n.anchor) : `${ctx.base}trips/${encodeURIComponent(n.trip)}/`
  link.toggleAttribute('data-new', fresh)
  const person = ctx.people[n.by]
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
  what.textContent = ctx.strings[n.kind]!.replace('{name}', person?.name ?? `@${n.by}`)
  const where = document.createElement('span')
  where.className = 'footnote secondary what'
  where.textContent = [
    target?.title,
    ctx.root.hasAttribute('data-several-trips') ? trip?.title : undefined,
    when(n.at, ctx.lang),
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
  const item = document.createElement('li')
  item.append(link)
  return item
}

async function markSeen() {
  await fetch('/api/notifications/seen', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
}

/** A `[data-push-toggle]`: this device's browser notifications, on or off. */
async function setupToggle(toggle: HTMLElement, session: Me) {
  const publicKey = session.push
  const state = publicKey ? await pushState() : 'unsupported'
  toggle.hidden = state === 'unsupported'
  if (toggle.hidden) return
  const status = toggle.querySelector<HTMLElement>('[data-push-status]')!
  const button = toggle.querySelector<HTMLButtonElement>('[data-push-switch]')!
  const d = toggle.dataset
  const show = (now: Awaited<ReturnType<typeof pushState>>) => {
    status.textContent = now === 'denied' ? d.denied! : now === 'on' ? d.on! : d.off!
    button.hidden = now === 'denied'
    button.textContent = now === 'on' ? d.turnOff! : d.turnOn!
    button.toggleAttribute('data-on', now === 'on')
  }
  show(state)
  button.onclick = async () => {
    button.disabled = true
    if (button.hasAttribute('data-on')) await turnOff()
    else await turnOn(publicKey!).catch(() => undefined)
    button.disabled = false
    show(await pushState())
  }
}

export async function setupNotifications() {
  const ctx = context()
  if (!ctx) return
  const session = await me()
  if (!session?.login || !session.comments.length) return
  const { root } = ctx
  const open = root.querySelector<HTMLButtonElement>('[data-notifications-open]')!
  const panel = root.querySelector<HTMLDialogElement>('[data-notifications-panel]')!
  const list = root.querySelector<HTMLElement>('[data-notifications-list]')!
  const count = root.querySelector<HTMLElement>('[data-notifications-count]')!
  const error = root.querySelector<HTMLElement>('[data-notifications-error]')!
  open.hidden = false

  let items: Notification[] = []
  let seenAt = 0
  /** What was new when the panel opened: it stays marked while it is open. */
  let shownSince = 0

  async function load() {
    try {
      ;({ notifications: items, seenAt } = await fetchPage(20))
      error.hidden = true
    } catch {
      error.textContent = ctx!.strings.error!
      error.hidden = false
    }
    const fresh = items.filter((n) => n.at > seenAt).length
    count.textContent = fresh ? String(fresh > 99 ? '99+' : fresh) : ''
    if (panel.open) await render()
  }

  async function render() {
    list.replaceChildren(...(await Promise.all(items.map((n) => renderItem(n, ctx!, n.at > shownSince)))))
    root.querySelector<HTMLElement>('[data-notifications-none]')!.hidden = items.length > 0
  }

  open.addEventListener('click', async () => {
    shownSince = seenAt
    panel.showModal()
    await render()
    void setupToggle(root.querySelector<HTMLElement>('[data-push-toggle]')!, session)
    // Opening the center reads it.
    if (items.some((n) => n.at > seenAt)) {
      await markSeen()
      seenAt = Date.now()
      count.textContent = ''
    }
  })
  list.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) panel.close()
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

/** The full page: everything, newest first, a page at a time. */
export async function setupNotificationsPage() {
  const page = document.querySelector<HTMLElement>('[data-notifications-page]')
  const ctx = context()
  if (!page || !ctx) return
  const session = await me()
  if (!session?.login) return
  const list = page.querySelector<HTMLElement>('[data-page-list]')!
  const more = page.querySelector<HTMLButtonElement>('[data-page-more]')!
  const none = page.querySelector<HTMLElement>('[data-page-none]')!
  void setupToggle(page.querySelector<HTMLElement>('[data-push-toggle]')!, session)
  let before: number | undefined
  let seenAt: number | undefined
  const next = async () => {
    more.disabled = true
    const result = await fetchPage(50, before).catch(() => null)
    more.disabled = false
    if (!result) return
    seenAt ??= result.seenAt
    list.append(...(await Promise.all(result.notifications.map((n) => renderItem(n, ctx, n.at > seenAt!)))))
    before = result.notifications.at(-1)?.at
    more.hidden = !result.more
    none.hidden = list.children.length > 0
  }
  more.onclick = () => void next()
  await next()
  await markSeen()
  ctx.root.querySelector<HTMLElement>('[data-notifications-count]')!.textContent = ''
}
