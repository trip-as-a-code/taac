// The notification center: the bell with its unread count and the latest
// notifications, and the full page with all of them, by day, a page at a
// time. Each is read or not: opening one reads it, any can be marked read or
// unread, and "mark all as read" reads everything. Also this device's switch
// for browser notifications, on the full page.

import { pushState, testPush, turnOff, turnOn } from '@/scripts/push'
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
  read: boolean
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

/** Anything read or unread anywhere on the page (the bell, the full page, a discussion). */
const CHANGED = 'taac:notifications'

/** Trip titles and where each anchor is, fetched once per trip. */
const targets = new Map<
  string,
  Promise<{ title: string; targets: Record<string, { title: string; href: string }> } | null>
>()
let listening = false
/** The current page's refresh of the bell, for the one set of listeners. */
let refreshBell: (() => Promise<void>) | undefined

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
  options: { before?: number; unread?: boolean } = {},
): Promise<{ notifications: Notification[]; unread: number; more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (options.before) params.set('before', String(options.before))
  if (options.unread) params.set('unread', '1')
  const response = await fetch(`/api/notifications?${params}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
}

/** Marks notifications (or everything, or a discussion's) and tells the rest of the page. */
export async function markNotifications(read: boolean, which: { ids?: string[]; threads?: string[]; all?: boolean }) {
  const response = await fetch(`/api/notifications/${read ? 'read' : 'unread'}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(which),
    // A tap that leaves the page still counts.
    keepalive: true,
  }).catch(() => null)
  if (response?.ok) document.dispatchEvent(new CustomEvent(CHANGED))
}

/** One notification: who did what, where and when, and what they said. */
async function renderItem(n: Notification, ctx: Context, withToggle: boolean): Promise<HTMLLIElement> {
  const trip = await targetsOf(ctx.base, n.trip)
  const target = trip?.targets[n.anchor]
  const item = document.createElement('li')
  item.toggleAttribute('data-unread', !n.read)
  const link = document.createElement('a')
  link.href = target ? linkTo(target.href, n.anchor) : `${ctx.base}trips/${encodeURIComponent(n.trip)}/`
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
  what.className = 'subhead title'
  what.textContent = ctx.strings[n.kind]!.replace('{name}', person?.name ?? `@${n.by}`)
  const where = document.createElement('span')
  where.className = 'footnote secondary meta'
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
    text.className = 'subhead secondary text'
    text.textContent = n.text
    link.append(text)
  }
  link.addEventListener('click', () => {
    if (!n.read) void markNotifications(true, { ids: [n.id] })
  })
  item.append(link)
  if (withToggle) {
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'mark'
    const show = () => {
      const label = n.read ? ctx.strings.markUnread! : ctx.strings.markRead!
      toggle.title = label
      toggle.setAttribute('aria-label', label)
      toggle.toggleAttribute('data-read', n.read)
      item.toggleAttribute('data-unread', !n.read)
    }
    show()
    toggle.addEventListener('click', () => {
      n.read = !n.read
      show()
      void markNotifications(n.read, { ids: [n.id] })
    })
    item.append(toggle)
  }
  return item
}

/** A `[data-push-toggle]`: this device's browser notifications: a switch, or why there is none; and a test. */
async function setupToggle(toggle: HTMLElement, session: Me) {
  const publicKey = session.push
  const section = toggle.closest<HTMLElement>('[data-push-section]')
  // Without the server's key there are no browser notifications at all.
  if (section) section.hidden = !publicKey
  if (!publicKey) return
  const status = toggle.querySelector<HTMLElement>('[data-push-status]')!
  const button = toggle.querySelector<HTMLButtonElement>('[data-push-switch]')!
  const testRow = toggle.querySelector<HTMLElement>('[data-push-test-row]')!
  const test = toggle.querySelector<HTMLButtonElement>('[data-push-test]')!
  const testStatus = toggle.querySelector<HTMLElement>('[data-push-test-status]')!
  const d = toggle.dataset
  const show = (now: Awaited<ReturnType<typeof pushState>>) => {
    button.hidden = now === 'unsupported' || now === 'home-screen'
    button.setAttribute('aria-checked', String(now === 'on'))
    button.disabled = now === 'denied'
    status.textContent =
      now === 'denied'
        ? d.denied!
        : now === 'unsupported'
          ? d.unsupported!
          : now === 'home-screen'
            ? d.homeScreen!
            : d.hint!
    testRow.hidden = now !== 'on'
  }
  show(await pushState().catch(() => 'unsupported' as const))
  button.onclick = async () => {
    button.disabled = true
    if (button.getAttribute('aria-checked') === 'true') await turnOff()
    else await turnOn(publicKey).catch(() => undefined)
    show(await pushState().catch(() => 'unsupported' as const))
  }
  test.onclick = async () => {
    test.disabled = true
    const result = await testPush()
    test.disabled = false
    testStatus.textContent = result && result.sent > 0 ? d.sent! : d.failed!
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
  const readAll = root.querySelector<HTMLButtonElement>('[data-notifications-read-all]')!
  open.hidden = false

  let items: Notification[] = []
  let unread = 0

  async function load() {
    try {
      ;({ notifications: items, unread } = await fetchPage(20))
      error.hidden = true
    } catch {
      error.textContent = ctx!.strings.error!
      error.hidden = false
    }
    count.textContent = unread ? String(unread > 99 ? '99+' : unread) : ''
    readAll.hidden = unread === 0
    if (panel.open) await render()
  }

  async function render() {
    list.replaceChildren(...(await Promise.all(items.map((n) => renderItem(n, ctx!, false)))))
    root.querySelector<HTMLElement>('[data-notifications-none]')!.hidden = items.length > 0
  }

  open.addEventListener('click', async () => {
    panel.showModal()
    await render()
  })
  readAll.addEventListener('click', () => void markNotifications(true, { all: true }))
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
      if (document.visibilityState === 'visible') void refreshBell?.()
    })
    document.addEventListener(CHANGED, () => void refreshBell?.())
  }
  refreshBell = load
  await load()
}

/** The full page: all notifications by day, all or only unread, a page at a time. */
export async function setupNotificationsPage() {
  const page = document.querySelector<HTMLElement>('[data-notifications-page]')
  const ctx = context()
  if (!page || !ctx) return
  const session = await me()
  if (!session?.login) return
  const days = page.querySelector<HTMLElement>('[data-page-days]')!
  const more = page.querySelector<HTMLButtonElement>('[data-page-more]')!
  const none = page.querySelector<HTMLElement>('[data-page-none]')!
  const readAll = page.querySelector<HTMLButtonElement>('[data-page-read-all]')!
  void setupToggle(page.querySelector<HTMLElement>('[data-push-toggle]')!, session)

  let unreadOnly = false
  let before: number | undefined
  const dayKey = (ms: number) => new Date(ms).toDateString()
  const dayTitle = (ms: number) => {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86_400_000)
    if (dayKey(ms) === today.toDateString()) return ctx.strings.today!
    if (dayKey(ms) === yesterday.toDateString()) return ctx.strings.yesterday!
    const name = new Intl.DateTimeFormat(ctx.lang, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: new Date(ms).getFullYear() === today.getFullYear() ? undefined : 'numeric',
    }).format(ms)
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  /** The day's list, made when its first notification arrives. */
  function listFor(ms: number): HTMLElement {
    const key = dayKey(ms)
    let section = days.querySelector<HTMLElement>(`[data-day="${CSS.escape(key)}"]`)
    if (!section) {
      section = document.createElement('section')
      section.className = 'day'
      section.dataset.day = key
      const title = document.createElement('h2')
      title.className = 'title-3 day-title'
      title.textContent = dayTitle(ms)
      const list = document.createElement('ul')
      list.className = 'card list items'
      section.append(title, list)
      days.append(section)
    }
    return section.querySelector('ul')!
  }

  async function next() {
    more.disabled = true
    const result = await fetchPage(50, { before, unread: unreadOnly }).catch(() => null)
    more.disabled = false
    if (!result) return
    for (const n of result.notifications) listFor(n.at).append(await renderItem(n, ctx!, true))
    before = result.notifications.at(-1)?.at
    more.hidden = !result.more
    none.hidden = days.children.length > 0
    readAll.hidden = result.unread === 0
  }

  async function restart() {
    before = undefined
    days.replaceChildren()
    await next()
  }

  for (const button of page.querySelectorAll<HTMLButtonElement>('[data-filter]'))
    button.addEventListener('click', () => {
      unreadOnly = button.dataset.filter === 'unread'
      for (const other of page.querySelectorAll('[data-filter]'))
        other.setAttribute('aria-pressed', String(other === button))
      void restart()
    })
  readAll.addEventListener('click', async () => {
    await markNotifications(true, { all: true })
    await restart()
  })
  more.onclick = () => void next()
  await next()
}
