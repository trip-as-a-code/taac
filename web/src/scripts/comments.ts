// Discussions on the page: shows each ThreadButton (with its open-thread
// count and an unread dot) and opens the thread panel, also when a
// notification links here (`?thread=<anchor>`). Threads come from the server for the whole trip and are
// fetched again when the page comes back into view.

import { me } from '@/scripts/session'

interface Comment {
  id: string
  author: string
  body: string
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
}

interface Thread {
  id: string
  anchor: string
  createdBy: string
  createdAt: number
  resolvedAt: number | null
  resolvedBy: string | null
  comments: Comment[]
}

interface Person {
  name: string
  initials: string
  hue: number
}

const state = {
  slug: '',
  threads: [] as Thread[],
  fetchedAt: 0,
  login: null as string | null,
  writer: false,
  /** The anchor the panel shows, while it is open. */
  open: null as { anchor: string; title: string } | null,
}
let listening = false

const seenKey = () => `taac:comments-seen:${state.slug}`

function readSeen(): Record<string, number> | null {
  try {
    return JSON.parse(localStorage.getItem(seenKey()) ?? 'null') as Record<string, number> | null
  } catch {
    return null
  }
}

function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(seenKey(), JSON.stringify(seen))
  } catch {
    // Only a convenience.
  }
}

const latest = (thread: Thread) => Math.max(...thread.comments.map((c) => c.editedAt ?? c.createdAt), thread.createdAt)

/** Someone else wrote since this device last showed the thread. */
function unread(thread: Thread, seen: Record<string, number>): boolean {
  return thread.comments.some((c) => c.author !== state.login && c.createdAt > (seen[thread.id] ?? 0))
}

function markSeen(threads: Thread[]) {
  const seen = readSeen() ?? {}
  for (const thread of threads) seen[thread.id] = latest(thread)
  writeSeen(seen)
}

async function api(path = '', init?: RequestInit): Promise<boolean> {
  const panel = document.querySelector<HTMLElement>('[data-thread-panel]')
  const error = panel?.querySelector<HTMLElement>('[data-panel-error]')
  try {
    const response = await fetch(`/api/trips/${encodeURIComponent(state.slug)}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    if (!response.ok) throw new Error(String(response.status))
    state.threads = ((await response.json()) as { threads: Thread[] }).threads
    state.fetchedAt = Date.now()
    if (error) error.hidden = true
    // A change made here redraws the panel; a refresh in the background spares what is being typed.
    refresh(init?.method !== undefined && init.method !== 'GET')
    return true
  } catch {
    if (error && panel) {
      error.textContent = (JSON.parse(panel.dataset.strings ?? '{}') as Record<string, string>).error ?? ''
      error.hidden = false
    }
    return false
  }
}

const send = (path: string, method: string, body?: unknown) =>
  api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

/** Buttons, the tab's count, the open panel and the Discussions list, from `state.threads`. */
function refresh(redraw = true) {
  // The first look on this device takes everything so far as read.
  let seen = readSeen()
  if (!seen) {
    markSeen(state.threads)
    seen = readSeen() ?? {}
  }
  const byAnchor = new Map<string, Thread[]>()
  for (const t of state.threads) byAnchor.set(t.anchor, [...(byAnchor.get(t.anchor) ?? []), t])
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-thread]')) {
    const threads = byAnchor.get(button.dataset.thread!) ?? []
    const open = threads.filter((t) => t.resolvedAt === null)
    button.hidden = !state.writer && threads.length === 0
    button.dataset.state = open.length ? 'open' : threads.length ? 'resolved' : 'none'
    button.querySelector('[data-thread-count]')!.textContent = open.length ? String(open.length) : ''
    button.toggleAttribute(
      'data-unread',
      threads.some((t) => unread(t, seen)),
    )
  }
  if (state.open) renderPanel(redraw)
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(label: string, onClick: () => void, className = 'button button-plain') {
  const b = el('button', className, label)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/** A textarea that sends on Cmd/Ctrl+Enter. */
function textarea(placeholder: string, value = '') {
  const area = el('textarea')
  area.rows = 2
  area.maxLength = 4000
  area.placeholder = placeholder
  area.value = value
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) area.form?.requestSubmit()
  })
  return area
}

function avatar(login: string, people: Record<string, Person>) {
  const person = people[login]
  const span = el('span', 'avatar', person?.initials ?? login.slice(0, 1).toUpperCase())
  span.style.setProperty('--hue', String(person?.hue ?? 210))
  const img = el('img', 'avatar-photo')
  img.src = `/api/avatars/${login}`
  img.alt = ''
  img.dataset.avatarPhoto = ''
  span.append(img)
  return span
}

function relative(ms: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 7) return rtf.format(days, 'day')
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(ms)
}

function nameOf(login: string, people: Record<string, Person>): string {
  return people[login]?.name ?? `@${login}`
}

function renderThread(thread: Thread, panel: HTMLElement): HTMLElement {
  const s = JSON.parse(panel.dataset.strings ?? '{}') as Record<string, string>
  const people = JSON.parse(panel.dataset.people ?? '{}') as Record<string, Person>
  const lang = panel.dataset.lang!
  const box = el('article', 'thread')
  box.toggleAttribute('data-resolved', thread.resolvedAt !== null)
  for (const comment of thread.comments) {
    const row = el('div', 'comment')
    const body = el('div')
    const head = el('div', 'comment-head')
    head.append(el('strong', 'subhead', nameOf(comment.author, people)))
    head.append(el('span', 'footnote tertiary', relative(comment.createdAt, lang)))
    if (comment.editedAt && !comment.deletedAt) head.append(el('span', 'footnote tertiary', s.edited))
    body.append(head)
    const text = comment.deletedAt ? el('p', 'comment-body gone', s.deleted) : el('p', 'comment-body', comment.body)
    body.append(text)
    if (state.writer && comment.author === state.login && !comment.deletedAt) {
      const actions = el('div', 'comment-actions')
      actions.append(
        button(s.edit!, () => {
          const form = el('form', 'reply')
          const area = textarea('', comment.body)
          form.append(
            area,
            button(s.cancel!, () => renderPanel()),
            Object.assign(el('button', 'button button-primary', s.save), { type: 'submit' }),
          )
          form.addEventListener('submit', (event) => {
            event.preventDefault()
            void send(`/comments/${comment.id}`, 'PATCH', { body: area.value })
          })
          text.replaceWith(form)
          actions.remove()
          area.focus()
        }),
      )
      const del = button(
        s.delete!,
        () => {
          // A second tap confirms.
          if (!del.dataset.armed) {
            del.dataset.armed = ''
            del.textContent = s.confirm!
            setTimeout(() => {
              delete del.dataset.armed
              del.textContent = s.delete!
            }, 3000)
            return
          }
          void send(`/comments/${comment.id}`, 'DELETE')
        },
        'button button-plain danger',
      )
      actions.append(del)
      body.append(actions)
    }
    row.append(avatar(comment.author, people), body)
    box.append(row)
  }
  if (state.writer && thread.resolvedAt === null) {
    const form = el('form', 'reply')
    const area = textarea(s.replyPlaceholder!)
    form.append(area, Object.assign(el('button', 'button button-primary', s.send), { type: 'submit' }))
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (area.value.trim()) void send(`/threads/${thread.id}/comments`, 'POST', { body: area.value })
    })
    box.append(form)
  }
  const actions = el('div', 'thread-actions')
  actions.append(
    el(
      'span',
      'footnote secondary',
      thread.resolvedBy ? s.resolvedBy!.replace('{name}', nameOf(thread.resolvedBy, people)) : '',
    ),
  )
  if (state.writer)
    actions.append(
      button(
        thread.resolvedAt === null ? s.resolve! : s.reopen!,
        () => void send(`/threads/${thread.id}`, 'PATCH', { resolved: thread.resolvedAt === null }),
      ),
    )
  box.append(actions)
  return box
}

function renderPanel(redraw = true) {
  const panel = document.querySelector<HTMLDialogElement>('[data-thread-panel]')
  if (!panel || !state.open) return
  const s = JSON.parse(panel.dataset.strings ?? '{}') as Record<string, string>
  // Keep what is being typed when the threads come back from a refresh.
  const typing = panel.querySelector<HTMLTextAreaElement>('textarea:focus')
  if (!redraw && typing?.value) return
  panel.querySelector('[data-panel-title]')!.textContent = state.open.title
  const threads = state.threads.filter((t) => t.anchor === state.open!.anchor)
  const open = threads.filter((t) => t.resolvedAt === null)
  const resolved = threads.filter((t) => t.resolvedAt !== null)
  const list = panel.querySelector<HTMLElement>('[data-panel-threads]')!
  const nodes: HTMLElement[] = open.map((t) => renderThread(t, panel))
  if (resolved.length) {
    const details = el('details', 'resolved-list')
    details.append(el('summary', 'footnote', s.resolvedCount!.replace('{n}', String(resolved.length))))
    const inner = el('div', 'threads')
    inner.append(...resolved.map((t) => renderThread(t, panel)))
    details.append(inner)
    // Nothing open: show what was settled.
    details.open = open.length === 0
    nodes.push(details)
  }
  list.replaceChildren(...nodes)
  panel.querySelector<HTMLElement>('[data-panel-new]')!.hidden = !state.writer
  panel.querySelector<HTMLElement>('[data-panel-read-only]')!.hidden = state.writer || threads.length === 0
  markSeen(threads)
}

export function openThreads(anchor: string, title: string) {
  const panel = document.querySelector<HTMLDialogElement>('[data-thread-panel]')
  if (!panel) return
  state.open = { anchor, title }
  renderPanel()
  if (!panel.open) panel.showModal()
  refresh()
  if (!state.threads.some((t) => t.anchor === anchor))
    panel.querySelector<HTMLTextAreaElement>('[data-panel-new] textarea')?.focus()
}

export async function setupComments() {
  const panel = document.querySelector<HTMLDialogElement>('[data-thread-panel]')
  if (!panel) return
  const slug = panel.dataset.threadPanel!
  const session = await me()
  if (!session) return
  state.login = session.login
  state.writer = session.comments.includes(slug)
  if (!state.writer && session.link?.trip !== slug) return
  if (state.slug !== slug || Date.now() - state.fetchedAt > 60_000) {
    state.slug = slug
    await api('/threads')
  } else refresh()

  // Arrived from a notification: open that discussion, then forget the parameter.
  const asked = new URL(location.href).searchParams.get('thread')
  if (asked) {
    const button = document.querySelector<HTMLElement>(`[data-thread="${CSS.escape(asked)}"]`)
    openThreads(asked, button?.dataset.threadTitle ?? '')
    const url = new URL(location.href)
    url.searchParams.delete('thread')
    history.replaceState(history.state, '', url)
  }

  panel.addEventListener('close', () => {
    state.open = null
    refresh()
  })
  panel.querySelector('[data-panel-close]')!.addEventListener('click', () => panel.close())
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.close()
  })
  const form = panel.querySelector<HTMLFormElement>('[data-panel-new]')!
  const area = form.querySelector('textarea')!
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.open || !area.value.trim()) return
    if (await send('/threads', 'POST', { anchor: state.open.anchor, body: area.value })) form.reset()
  })
  if (!listening) {
    listening = true
    document.addEventListener('click', (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-thread]')
      if (!target) return
      event.preventDefault()
      event.stopPropagation()
      openThreads(target.dataset.thread!, target.dataset.threadTitle ?? '')
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.slug) void api('/threads')
    })
  }
}
