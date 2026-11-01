// Discussions next to what they discuss, opened in place like comments in a
// document. Wide screens: a rail in the margin right of the centred page, each
// thing's threads level with it. Narrower screens and phones: the same threads
// inside the row. Either way the row's own chat button starts one, so the
// pointer never has to cross the page (or the next column) to reach it. A thread opens to the whole conversation, with
// replies, edits and resolving right there; one at a time.

import { avatarPhoto } from '@/scripts/avatars'

export interface RailThread {
  id: string
  anchor: string
  createdAt: number
  createdBy: string
  resolvedAt: number | null
  comments: { author: string; body: string; createdAt: number; deletedAt: number | null }[]
}

export interface RailOptions {
  threads: RailThread[]
  login: string | null
  writer: boolean
  people: Record<string, { name: string; initials: string; hue: number }>
  strings: Record<string, string>
  lang: string
  unread: (thread: RailThread) => boolean
  /** The whole thread: its comments, the reply box, resolving. */
  render: (thread: RailThread) => HTMLElement
  create: (anchor: string, body: string) => Promise<boolean>
  seen: (threads: RailThread[]) => void
}

/** The rail lives in the margin right of the centred page, only when that margin can hold it. */
const POINTER = '(hover: hover)'
const NARROWEST = 220
const WIDEST = 300
const GAP = 8
/** What a thread is about: the row, card or heading its button sits in. */
const HOST = '[data-item], article, li, .day-header, .heading'
/** Where threads fit inside the page on narrow screens. */
const PEEKS = '[data-item], article, .day-header'

let options: RailOptions | undefined
let observer: ResizeObserver | undefined
let frame = 0
let mode: 'rail' | 'peeks' | undefined
/** Each discussed thing's threads, built when they change and placed whenever the page moves. */
let groups = new Map<string, HTMLElement>()
/** The thread open in full; a new one being written; things showing their resolved threads. */
let expanded: string | null = null
let draft: string | null = null
let pending: string | null = null
const showResolved = new Set<string>()
/** The thing under the pointer, lit again whenever the rail redraws. */
let lit: string | undefined

const hostOf = (button: Element) => button.closest<HTMLElement>(HOST) ?? button.parentElement!
const buttonFor = (anchor: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-thread="${CSS.escape(anchor)}"]`)].find(
    (b) => hostOf(b).getClientRects().length > 0 && !b.closest('[hidden]'),
  )

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function avatar(login: string): HTMLElement {
  const person = options!.people[login]
  const span = el('span', 'avatar', person?.initials ?? login.slice(0, 1).toUpperCase())
  span.style.setProperty('--hue', String(person?.hue ?? 210))
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

/** Something is being typed in it: a redraw would lose it. */
const typing = (root: Element) =>
  [...root.querySelectorAll('textarea')].some((t) => t.value.trim() !== '' && t.value !== t.defaultValue)

/** A thread folded to its first words; a click opens it in full. */
function folded(thread: RailThread): HTMLElement {
  const lead = thread.comments.find((c) => !c.deletedAt) ?? thread.comments[0]!
  const box = el('button', 'thread-card')
  box.type = 'button'
  box.dataset.threadCard = thread.id
  box.toggleAttribute('data-unread', options!.unread(thread))
  box.toggleAttribute('data-resolved', thread.resolvedAt !== null)
  const head = el('span', 'rail-head')
  head.append(
    avatar(lead.author),
    el('strong', undefined, options!.people[lead.author]?.name ?? `@${lead.author}`),
    el('span', 'rail-when', relative(Math.max(...thread.comments.map((c) => c.createdAt)))),
  )
  box.append(head, el('span', 'rail-body', lead.deletedAt ? options!.strings.deleted! : lead.body))
  const replies = thread.comments.length - 1
  if (replies > 0) box.append(el('span', 'rail-more', options!.strings.railReplies!.replace('{n}', String(replies))))
  box.addEventListener('click', () => open(thread.id))
  return box
}

/** A thread in full, where it sits. */
function unfolded(thread: RailThread): HTMLElement {
  const box = el('div', 'thread-card')
  box.dataset.threadCard = thread.id
  box.dataset.expanded = ''
  box.toggleAttribute('data-resolved', thread.resolvedAt !== null)
  const close = el('button', 'icon-button')
  close.type = 'button'
  close.title = options!.strings.collapse!
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>'
  close.append(el('span', 'visually-hidden', close.title))
  close.addEventListener('click', () => collapse())
  const body = options!.render(thread)
  // The fold button joins resolving at the top right.
  ;(body.querySelector('.thread-tools') ?? body).append(close)
  box.append(body)
  return box
}

/** A new thread being written, in place of the dialog. */
function composer(anchor: string): HTMLElement {
  const form = el('form', 'thread-card thread-new')
  form.dataset.threadCard = 'new'
  const area = el('textarea')
  area.rows = 2
  area.maxLength = 4000
  area.placeholder = options!.strings.newPlaceholder!
  area.required = true
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit()
    if (event.key === 'Escape') cancelDraft()
  })
  const actions = el('div', 'thread-new-actions')
  const cancel = el('button', 'button button-plain', options!.strings.cancel)
  cancel.type = 'button'
  cancel.addEventListener('click', cancelDraft)
  const submit = el('button', 'button button-primary', options!.strings.new)
  submit.type = 'submit'
  actions.append(cancel, submit)
  form.append(area, actions)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!area.value.trim()) return
    submit.disabled = true
    pending = anchor
    if (await options!.create(anchor, area.value)) {
      draft = null
      build()
    } else {
      pending = null
      submit.disabled = false
    }
  })
  queueMicrotask(() => area.focus({ preventScroll: true }))
  return form
}

/** One thing's threads: open ones, then a fold for the resolved, then a new one being written. */
function group(anchor: string, threads: RailThread[]): HTMLElement {
  const box = el('div', mode === 'rail' ? 'rail-group' : 'thread-peeks')
  box.dataset.threadGroup = anchor
  box.toggleAttribute('data-rail-lit', anchor === lit)
  const open = threads.filter((t) => t.resolvedAt === null)
  const resolved = threads.filter((t) => t.resolvedAt !== null)
  box.append(...open.map((t) => (t.id === expanded ? unfolded(t) : folded(t))))
  if (resolved.length) {
    const shown = showResolved.has(anchor) || resolved.some((t) => t.id === expanded)
    const toggle = el(
      'button',
      'thread-resolved-toggle',
      options!.strings.resolvedCount!.replace('{n}', String(resolved.length)),
    )
    toggle.type = 'button'
    toggle.setAttribute('aria-expanded', String(shown))
    toggle.addEventListener('click', () => {
      if (shown) showResolved.delete(anchor)
      else showResolved.add(anchor)
      build()
    })
    box.append(toggle)
    if (shown) box.append(...resolved.map((t) => (t.id === expanded ? unfolded(t) : folded(t))))
  }
  if (draft === anchor) box.append(composer(anchor))
  // Another thread on the same thing, from its own group (the row's button does it inside the page).
  else if (mode === 'rail' && options!.writer && threads.length) {
    const more = el('button', 'thread-more', `+ ${options!.strings.new}`)
    more.type = 'button'
    more.addEventListener('click', () => showThreads(anchor, true))
    box.append(more)
  }
  return box
}

function wantedMode(): 'rail' | 'peeks' | undefined {
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')
  const content = rail?.parentElement?.querySelector<HTMLElement>('.content')
  if (!rail || !content || !options) return undefined
  // The margin right of the text, less a gutter at the window's edge.
  const gutter = parseFloat(getComputedStyle(content).paddingRight) || 0
  const room = document.documentElement.clientWidth - content.getBoundingClientRect().right - gutter
  rail.style.width = `${Math.min(room, WIDEST)}px`
  return matchMedia(POINTER).matches && room >= NARROWEST ? 'rail' : 'peeks'
}

/** Rebuilds every thing's threads from the data; keeps a draft or reply being typed. */
function build() {
  if (!options) return
  for (const g of groups.values()) g.remove()
  groups = new Map()
  mode = wantedMode()
  if (!mode) return
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')!
  const anchors = new Set(options.threads.map((t) => t.anchor))
  if (draft) anchors.add(draft)
  for (const anchor of anchors)
    groups.set(
      anchor,
      group(
        anchor,
        options.threads.filter((t) => t.anchor === anchor).sort((a, b) => a.createdAt - b.createdAt),
      ),
    )
  const on = mode === 'rail' && (options.writer || groups.size > 0)
  document.documentElement.toggleAttribute('data-rail', on)
  rail.hidden = !on
  place()
}

/** Puts each group by what it discusses: level with it in the rail, or inside it. */
function place() {
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')
  const page = rail?.parentElement
  const content = page?.querySelector<HTMLElement>('.content')
  if (!rail || !page || !content) return
  if (wantedMode() !== mode) return build()
  if (mode === 'peeks') {
    for (const [anchor, g] of groups) {
      const button = buttonFor(anchor)
      const host = button && hostOf(button)
      g.hidden = !host?.matches(PEEKS)
      if (!host || g.hidden) continue
      // Rows and cards take it inside; a day's heading, under it.
      if (host.matches('.day-header')) {
        if (host.nextElementSibling !== g) host.after(g)
      } else if (g.parentElement !== host) host.append(g)
    }
    return
  }
  const origin = page.getBoundingClientRect()
  rail.style.left = `${content.getBoundingClientRect().right - origin.left}px`
  const placed: { top: number; g: HTMLElement }[] = []
  for (const [anchor, g] of groups) {
    const button = buttonFor(anchor)
    g.hidden = !button
    if (!button) continue
    if (g.parentElement !== rail) rail.append(g)
    placed.push({ top: hostOf(button).getBoundingClientRect().top - origin.top, g })
  }
  placed.sort((a, b) => a.top - b.top)
  let floor = -Infinity
  for (const p of placed) {
    const top = Math.max(p.top, floor)
    p.g.style.top = `${top}px`
    floor = top + p.g.offsetHeight + GAP
  }
}

function schedule() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(place)
}

function open(id: string) {
  expanded = id
  const thread = options?.threads.find((t) => t.id === id)
  if (thread) options!.seen([thread])
  build()
}

function collapse() {
  if (expanded === null) return
  expanded = null
  build()
}

function cancelDraft() {
  draft = null
  build()
}

/**
 * Opens what is said about `anchor` where it is on the page: its first open
 * thread, or a new one to write. False when the page has nowhere to show it.
 */
export function showThreads(anchor: string, start = false): boolean {
  if (!options || !mode) return false
  const button = buttonFor(anchor)
  const host = button && hostOf(button)
  if (!host || (mode === 'peeks' && !host.matches(PEEKS))) return false
  const first = options.threads.find((t) => t.anchor === anchor && t.resolvedAt === null)
  if (first && !start) expanded = first.id
  else if (options.writer) {
    draft = anchor
    expanded = null
  } else if (!options.threads.some((t) => t.anchor === anchor)) return false
  if (first && !start) options.seen([first])
  build()
  groups.get(anchor)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return true
}

/** The row under the pointer and its threads light up together. */
function hover(event: Event) {
  if (mode !== 'rail') return
  const target = event.target as Element
  const fromGroup = target.closest<HTMLElement>('[data-thread-group]')
  let anchor = fromGroup?.dataset.threadGroup
  let host: HTMLElement | undefined
  if (fromGroup) {
    const button = buttonFor(anchor!)
    host = button ? hostOf(button) : undefined
  } else {
    const row = target.closest<HTMLElement>(HOST)
    const button = row?.querySelector<HTMLElement>('[data-thread]')
    if (row && button && hostOf(button) === row) {
      host = row
      anchor = button.dataset.thread
    }
  }
  // Between rows (on the way to the rail, say) nothing changes.
  if (!host || !anchor) return
  lit = anchor
  for (const node of document.querySelectorAll('[data-rail-lit]')) node.removeAttribute('data-rail-lit')
  host.setAttribute('data-rail-lit', '')
  groups.get(anchor)?.setAttribute('data-rail-lit', '')
}

/** A click elsewhere folds the open thread, unless something is being typed in it. */
function away(event: Event) {
  const target = event.target as Element
  if (target.closest('[data-thread-group], [data-thread], dialog')) return
  const card = document.querySelector('[data-thread-card][data-expanded]')
  if (card && !typing(card)) collapse()
}

/**
 * Draws the threads from the trip's discussions; called whenever they change.
 * A refresh in the background (`force` false) waits while something is typed.
 */
export function updateRail(next: RailOptions, force = true) {
  options = next
  const rail = document.querySelector<HTMLElement>('[data-thread-rail]')
  if (!rail) return
  // A thread just started: open it.
  if (pending) {
    const mine = next.threads
      .filter((t) => t.anchor === pending && t.createdBy === next.login)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    if (mine) expanded = mine.id
    pending = null
  }
  if (expanded && !next.threads.some((t) => t.id === expanded)) expanded = null
  if (!observer) {
    // Rows move when days fold, filters hide things or photos load.
    observer = new ResizeObserver(schedule)
    addEventListener('resize', schedule)
    document.addEventListener('mouseover', hover)
    document.addEventListener('toggle', schedule, true)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') collapse()
    })
  }
  observer.disconnect()
  const content = rail.parentElement?.querySelector('.content')
  if (content) observer.observe(content)
  // Typing a reply or a new thread: the refresh waits rather than take it away.
  const busy = [...groups.values()].some((g) => g.isConnected && typing(g))
  if (force || !busy) build()
}
