// Wide screens: open discussions sit in the margin right of the page, each
// card level with what it discusses, like comments in a document. Hovering a
// row offers to start one there. Narrower screens and phones show each one as
// a peek inside its row instead; its inline button still starts a new one.

import { avatarPhoto } from '@/scripts/avatars'

export interface RailThread {
  id: string
  anchor: string
  resolvedAt: number | null
  comments: { author: string; body: string; createdAt: number; deletedAt: number | null }[]
}

export interface RailOptions {
  threads: RailThread[]
  writer: boolean
  people: Record<string, { name: string; initials: string; hue: number }>
  strings: Record<string, string>
  lang: string
  unread: (thread: RailThread) => boolean
  open: (anchor: string, title: string) => void
}

/** The rail lives in the margin right of the centred page, only when that margin can hold it. */
const POINTER = '(hover: hover)'
const NARROWEST = 220
const WIDEST = 300
const GAP = 8
/** What a thread is about: the row, card or heading its button sits in. */
const HOST = '[data-item], article, li, .day-header, .heading'

let options: RailOptions | undefined
let observer: ResizeObserver | undefined
let frame = 0
/** The thing under the pointer, lit again whenever the rail redraws. */
let lit: string | undefined

const hostOf = (button: Element) => button.closest<HTMLElement>(HOST) ?? button.parentElement!

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && !el.closest('[hidden]')
}

function avatar(login: string): HTMLElement {
  const person = options!.people[login]
  const span = document.createElement('span')
  span.className = 'avatar'
  span.style.setProperty('--hue', String(person?.hue ?? 210))
  span.textContent = person?.initials ?? login.slice(0, 1).toUpperCase()
  span.append(avatarPhoto(login))
  return span
}

function relative(ms: number): string {
  const rtf = new Intl.RelativeTimeFormat(options!.lang, { numeric: 'auto' })
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(days, 'day')
  return new Intl.DateTimeFormat(options!.lang, { day: 'numeric', month: 'short' }).format(ms)
}

/** One card per discussed thing: its first open thread, and how much more there is. */
function card(anchor: string, threads: RailThread[], title: string): HTMLElement {
  const first = threads[0]!
  const lead = first.comments.find((c) => !c.deletedAt) ?? first.comments[0]!
  const box = document.createElement('button')
  box.type = 'button'
  box.className = 'rail-card'
  box.dataset.railAnchor = anchor
  box.toggleAttribute('data-unread', threads.some(options!.unread))
  box.toggleAttribute('data-rail-lit', anchor === lit)
  const head = document.createElement('span')
  head.className = 'rail-head'
  const name = document.createElement('strong')
  name.textContent = options!.people[lead.author]?.name ?? `@${lead.author}`
  const when = document.createElement('span')
  when.className = 'rail-when'
  when.textContent = relative(Math.max(...threads.flatMap((t) => t.comments.map((c) => c.createdAt))))
  head.append(avatar(lead.author), name, when)
  const body = document.createElement('span')
  body.className = 'rail-body'
  body.textContent = lead.deletedAt ? options!.strings.deleted! : lead.body
  box.append(head, body)
  const replies = threads.reduce((n, t) => n + t.comments.length, 0) - 1
  if (replies > 0 || threads.length > 1) {
    const more = document.createElement('span')
    more.className = 'rail-more'
    more.textContent = [
      replies > 0 && options!.strings.railReplies!.replace('{n}', String(replies)),
      threads.length > 1 && options!.strings.railThreads!.replace('{n}', String(threads.length)),
    ]
      .filter(Boolean)
      .join(' · ')
    box.append(more)
  }
  box.title = title
  box.addEventListener('click', () => options!.open(anchor, title))
  return box
}

/** Narrow screens: the first words of a discussion under what it is about; a tap opens it. */
function peeks(byAnchor: Map<string, RailThread[]>) {
  for (const old of document.querySelectorAll('[data-thread-peek]')) old.remove()
  for (const [anchor, threads] of byAnchor)
    for (const button of document.querySelectorAll<HTMLElement>(`[data-thread="${CSS.escape(anchor)}"]`)) {
      const host = hostOf(button)
      // Rows and cards take it inside; a day's heading, under it.
      const inside = host.matches('[data-item], article')
      if (!inside && !host.matches('.day-header')) continue
      const peek = card(anchor, threads, button.dataset.threadTitle ?? '')
      peek.className = 'thread-peek'
      peek.dataset.threadPeek = ''
      delete peek.dataset.railAnchor
      peek.removeAttribute('data-rail-lit')
      if (inside) host.append(peek)
      else host.after(peek)
    }
}

/** Cards level with their rows, pushed down where they would overlap. */
function layout() {
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')
  const page = rail?.parentElement
  const content = page?.querySelector<HTMLElement>('.content')
  if (!rail || !page || !content || !options) return
  // The margin right of the text, less a gutter at the window's edge.
  const gutter = parseFloat(getComputedStyle(content).paddingRight) || 0
  const room = document.documentElement.clientWidth - content.getBoundingClientRect().right - gutter
  const on =
    matchMedia(POINTER).matches &&
    room >= NARROWEST &&
    (options.writer || options.threads.some((t) => t.resolvedAt === null))
  rail.style.width = `${Math.min(room, WIDEST)}px`
  document.documentElement.toggleAttribute('data-rail', on)
  rail.hidden = !on
  const byAnchor = Map.groupBy(
    options.threads.filter((t) => t.resolvedAt === null),
    (t) => t.anchor,
  )
  if (!on) {
    rail.replaceChildren(...[...rail.children].filter((c) => c.matches('[data-rail-add]')))
    return peeks(byAnchor)
  }
  peeks(new Map())
  const origin = page.getBoundingClientRect()
  rail.style.left = `${content.getBoundingClientRect().right - origin.left}px`
  const placed: { top: number; el: HTMLElement; host: HTMLElement }[] = []
  for (const [anchor, threads] of byAnchor) {
    const button = [...document.querySelectorAll<HTMLElement>(`[data-thread="${CSS.escape(anchor)}"]`)].find((b) =>
      visible(hostOf(b)),
    )
    if (!button) continue
    const host = hostOf(button)
    const el = card(anchor, threads, button.dataset.threadTitle ?? '')
    placed.push({ top: host.getBoundingClientRect().top - origin.top, el, host })
  }
  placed.sort((a, b) => a.top - b.top)
  const add = rail.querySelector('[data-rail-add]')
  rail.replaceChildren(...placed.map((p) => p.el), ...(add ? [add] : []))
  let floor = -Infinity
  for (const p of placed) {
    const top = Math.max(p.top, floor)
    p.el.style.top = `${top}px`
    floor = top + p.el.offsetHeight + GAP
  }
}

function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(layout)
}

/** The row under the pointer and its card light up together; a row without one offers "+". */
function hover(event: Event) {
  if (!document.documentElement.hasAttribute('data-rail')) return
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')!
  const target = event.target as Element
  const fromCard = target.closest<HTMLElement>('[data-rail-anchor]')
  const overAdd = target.closest('[data-rail-add]')
  let anchor = fromCard?.dataset.railAnchor
  let host: HTMLElement | undefined
  if (fromCard) {
    const button = document.querySelector<HTMLElement>(`[data-thread="${CSS.escape(anchor!)}"]`)
    host = button ? hostOf(button) : undefined
  } else if (!overAdd) {
    const row = target.closest<HTMLElement>(HOST)
    const button = row?.querySelector<HTMLElement>('[data-thread]')
    if (row && button && hostOf(button) === row) {
      host = row
      anchor = button.dataset.thread
    }
  }
  // Between rows (on the way to the rail, say) nothing changes.
  if (overAdd || !host) return
  lit = anchor
  for (const el of document.querySelectorAll('[data-rail-lit]')) el.removeAttribute('data-rail-lit')
  host?.setAttribute('data-rail-lit', '')
  rail.querySelector(`[data-rail-anchor="${CSS.escape(anchor ?? '')}"]`)?.setAttribute('data-rail-lit', '')
  const add = rail.querySelector<HTMLButtonElement>('[data-rail-add]')!
  const free = host && anchor && options?.writer && !rail.querySelector(`[data-rail-anchor="${CSS.escape(anchor)}"]`)
  add.hidden = !free
  if (free) {
    const button = host!.querySelector<HTMLElement>('[data-thread]')!
    add.dataset.anchor = anchor
    add.dataset.title = button.dataset.threadTitle ?? ''
    // In the rail, level with the row; below whichever card already sits there.
    let top = host!.getBoundingClientRect().top - rail.parentElement!.getBoundingClientRect().top
    for (const card of [...rail.querySelectorAll<HTMLElement>('[data-rail-anchor]')].sort(
      (a, b) => a.offsetTop - b.offsetTop,
    ))
      if (top + add.offsetHeight > card.offsetTop && top < card.offsetTop + card.offsetHeight)
        top = card.offsetTop + card.offsetHeight + GAP
    add.style.top = `${top}px`
  }
}

/** Draws the rail from the trip's threads; called whenever they change. */
export function updateRail(next: RailOptions) {
  options = next
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')
  if (!rail) return
  if (!rail.querySelector('[data-rail-add]')) {
    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'rail-add'
    add.dataset.railAdd = ''
    add.hidden = true
    add.title = next.strings.new!
    add.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>'
    add.append(Object.assign(document.createElement('span'), { className: 'visually-hidden', textContent: add.title }))
    add.addEventListener('click', () => options?.open(add.dataset.anchor!, add.dataset.title ?? ''))
    rail.append(add)
  }
  if (!observer) {
    // Rows move when days fold, filters hide things or photos load.
    observer = new ResizeObserver(schedule)
    addEventListener('resize', schedule)
    document.addEventListener('mouseover', hover)
    document.addEventListener('toggle', schedule, true)
  }
  observer.disconnect()
  const content = rail.parentElement?.querySelector('.content')
  if (content) observer.observe(content)
  schedule()
}
