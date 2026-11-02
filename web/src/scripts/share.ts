// View-only links: the members' Share sheet (list, make, copy, revoke), and
// for someone who came by a link, a badge saying so.

import { closeOnBackdrop } from '@/scripts/sheet'
import { me } from '@/scripts/session'

interface Link {
  id: string
  label: string
  url: string
  createdBy: string
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
}

function relative(ms: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}

export async function setupShare() {
  const root = document.querySelector<HTMLElement>('[data-share]')
  if (!root) return
  const slug = root.dataset.share!
  const lang = root.dataset.lang!
  const d = root.dataset
  const date = (ms: number) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(ms)
  const until = (expiresAt: number | null) =>
    expiresAt === null ? d.forever! : d.until!.replace('{date}', date(expiresAt))

  const session = await me()
  if (!session) return
  const viaLink = !session.login && session.link?.trip === slug
  document.documentElement.toggleAttribute('data-link', viaLink)
  if (viaLink) {
    const badge = root.querySelector<HTMLElement>('[data-link-badge]')!
    const text = badge.querySelector('[data-link-badge-text]')!
    text.textContent = `${text.textContent} · ${until(session.link!.expiresAt)}`
    badge.hidden = false
  }
  if (!session.share.includes(slug)) return

  const open = root.querySelector<HTMLButtonElement>('[data-share-open]')!
  const dialog = root.querySelector<HTMLDialogElement>('[data-share-dialog]')!
  const form = root.querySelector<HTMLFormElement>('[data-share-form]')!
  const list = root.querySelector<HTMLUListElement>('[data-share-list]')!
  const none = root.querySelector<HTMLElement>('[data-share-none]')!
  const error = root.querySelector<HTMLElement>('[data-share-error]')!
  const logins = JSON.parse(d.logins ?? '{}') as Record<string, string>
  const api = `/api/trips/${encodeURIComponent(slug)}/links`
  open.hidden = false

  async function call(url: string, init?: RequestInit): Promise<Link[] | null> {
    try {
      const response = await fetch(url, { credentials: 'same-origin', ...init })
      if (!response.ok) throw new Error(String(response.status))
      error.hidden = true
      return ((await response.json()) as { links: Link[] }).links
    } catch {
      error.textContent = d.error!
      error.hidden = false
      return null
    }
  }

  async function copy(link: Link, button: HTMLButtonElement) {
    try {
      await navigator.clipboard.writeText(link.url)
      button.textContent = d.copied!
      setTimeout(() => (button.textContent = d.copyLabel!), 1500)
    } catch {
      prompt('', link.url)
    }
  }

  function render(links: Link[], fresh?: string) {
    list.replaceChildren(
      ...links.map((link) => {
        const item = document.createElement('li')
        item.dataset.id = link.id
        const what = document.createElement('div')
        what.className = 'what'
        const label = document.createElement('span')
        label.className = 'subhead'
        label.textContent = link.label || d.untitled!
        const meta = document.createElement('span')
        meta.className = 'footnote secondary'
        const by = logins[link.createdBy] ?? `@${link.createdBy}`
        const used = link.lastUsedAt ? d.opened!.replace('{rel}', relative(link.lastUsedAt, lang)) : d.unopened!
        meta.textContent = [by, until(link.expiresAt), used].join(' · ')
        what.append(label, meta)
        const actions = document.createElement('div')
        actions.className = 'actions'
        const copyButton = document.createElement('button')
        copyButton.type = 'button'
        copyButton.className = 'button button-plain'
        copyButton.textContent = d.copyLabel!
        copyButton.addEventListener('click', () => void copy(link, copyButton))
        const revoke = document.createElement('button')
        revoke.type = 'button'
        revoke.className = 'button button-plain revoke'
        revoke.textContent = d.revoke!
        revoke.addEventListener('click', async () => {
          // A second tap confirms.
          if (!('armed' in revoke.dataset)) {
            revoke.dataset.armed = ''
            revoke.textContent = d.confirm!
            setTimeout(() => {
              delete revoke.dataset.armed
              revoke.textContent = d.revoke!
            }, 3000)
            return
          }
          const left = await call(`${api}/${encodeURIComponent(link.id)}`, { method: 'DELETE' })
          if (left) render(left)
        })
        actions.append(copyButton, revoke)
        item.append(what, actions)
        if (link.id === fresh) void copy(link, copyButton)
        return item
      }),
    )
    none.hidden = links.length > 0
  }

  open.addEventListener('click', async () => {
    dialog.showModal()
    const links = await call(api)
    if (links) render(links)
  })
  root.querySelector('[data-share-close]')!.addEventListener('click', () => dialog.close())
  closeOnBackdrop(dialog)
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-lifetime]'))
    button.addEventListener('click', () => {
      for (const other of root.querySelectorAll('[data-lifetime]')) other.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-pressed', 'true')
    })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const expires = root.querySelector<HTMLElement>('[data-lifetime][aria-pressed="true"]')?.dataset.lifetime ?? '1w'
    const label = (form.elements.namedItem('label') as HTMLInputElement).value
    const before = new Set([...list.querySelectorAll('li')].map((li) => li.dataset.id))
    const links = await call(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, expires }),
    })
    if (!links) return
    form.reset()
    render(links, links.find((l) => !before.has(l.id))?.id)
  })
}
