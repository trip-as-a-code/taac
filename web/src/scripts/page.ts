// Per-navigation setup shared by every page (runs on `astro:page-load`).

import { setupAvatars } from '@/scripts/avatars'
import { revealTarget } from '@/scripts/filters'
import { fitAll } from '@/scripts/fit'
import { onMoney, renderMoney } from '@/scripts/money'
import { setupPickers } from '@/scripts/picker'
import { applySession } from '@/scripts/session'
import { setupShare } from '@/scripts/share'
import { setupTooltips } from '@/scripts/tooltip'

const LANG_COOKIE = 'taac_lang'
let once = false

/**
 * Runs `setup` on every visit to one trip section. Client-side navigation
 * keeps each visited page's scripts listening, so a page's setup has to
 * check that it is that page.
 */
export function onPage(section: string, setup: () => void) {
  document.addEventListener('astro:page-load', () => {
    if (document.querySelector<HTMLElement>('[data-section]')?.dataset.section === section) setup()
  })
}

export function setupPage() {
  rememberLanguageOnSwitch()
  forgetOfflineCopiesOnLogout()
  trackScroll()
  renderRelativeDates()
  showByDate()
  renderMoney()
  fitAll()
  setupAvatars()
  void applySession()
  void setupShare()
  setupPickers()
  setupTooltips()
  if (!once) {
    once = true
    onMoney(() => renderMoney())
    setupAnchors()
    registerServiceWorker()
    watchForNewBuild()
  }
}

const copiedTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/** Copies the full URL of a `[data-anchor]` link and updates the hash without toggling `<details>`. */
function setupAnchors() {
  document.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('[data-anchor]')
    if (!link) return
    const href = link.getAttribute('href')
    if (!href?.startsWith('#')) return
    event.preventDefault()
    event.stopPropagation()
    history.replaceState(history.state, '', href)
    // The plain address: the sharer's people and filter choices stay theirs.
    const url = `${location.origin}${location.pathname}${href}`
    const show = (state: 'copied' | 'failed') => {
      delete link.dataset.copied
      delete link.dataset.copyFailed
      link.dataset[state === 'copied' ? 'copied' : 'copyFailed'] = ''
      const label = link.getAttribute('aria-label') ?? ''
      if (state === 'failed') link.title = link.dataset.failed ?? label
      clearTimeout(copiedTimers.get(link))
      copiedTimers.set(
        link,
        setTimeout(() => {
          delete link.dataset.copied
          delete link.dataset.copyFailed
          link.title = label
        }, 1500),
      )
    }
    // Only say "copied" once it was; the address bar still has the link.
    if (navigator.clipboard)
      navigator.clipboard.writeText(url).then(
        () => show('copied'),
        () => show('failed'),
      )
    else show('failed')
    const target = document.getElementById(decodeURIComponent(href.slice(1)))
    if (target?.hasAttribute('data-item')) {
      target.classList.remove('flash')
      void target.offsetWidth
      target.classList.add('flash')
    }
  })
  window.addEventListener('hashchange', () => revealTarget())
}

function rememberLanguageOnSwitch() {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-set-lang]')) {
    link.addEventListener('click', () => {
      const lang = link.dataset.setLang!
      document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`
      try {
        localStorage.setItem(LANG_COOKIE, lang)
      } catch {
        // Storage can be unavailable (private mode); the cookie still works.
      }
    })
  }
}

function forgetOfflineCopiesOnLogout() {
  document.querySelector('form[action="/api/logout"]')?.addEventListener('submit', () => {
    if ('caches' in window) void caches.delete('taac-v1')
  })
}

let observer: IntersectionObserver | undefined

/** Hairline under the bar once scrolled; compact title once the large one is gone. */
function trackScroll() {
  const root = document.documentElement
  const update = () => root.toggleAttribute('data-scrolled', window.scrollY > 4)
  update()
  window.removeEventListener('scroll', update)
  window.addEventListener('scroll', update, { passive: true })

  observer?.disconnect()
  root.removeAttribute('data-title-hidden')
  const title = document.querySelector('[data-large-title]')
  if (!title) return
  observer = new IntersectionObserver(([entry]) => root.toggleAttribute('data-title-hidden', !entry.isIntersecting), {
    rootMargin: '-52px 0px 0px 0px',
  })
  observer.observe(title)
}

/**
 * `<time data-relative="2026-12-10" data-template="Starts {rel}">` →
 * "Starts in 46 days". Static HTML can't know today's date.
 */
export function renderRelativeDates(root: ParentNode = document) {
  const lang = document.documentElement.lang
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const today = todayUTC()
  for (const el of root.querySelectorAll<HTMLElement>('[data-relative]')) {
    const days = Math.round((Date.parse(`${el.dataset.relative}T00:00:00Z`) - today) / 86_400_000)
    const rel = Math.abs(days) >= 60 ? rtf.format(Math.round(days / 30), 'month') : rtf.format(days, 'day')
    el.textContent = (el.dataset.template ?? '{rel}').replace('{rel}', rel)
    el.dataset.days = String(days)
  }
}

/** What depends on the day: shown from (`data-show-from`) or until (`data-show-until`) a date. */
function showByDate() {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  for (const el of document.querySelectorAll<HTMLElement>('[data-show-from]')) el.hidden = today < el.dataset.showFrom!
  for (const el of document.querySelectorAll<HTMLElement>('[data-show-until]'))
    el.hidden = today >= el.dataset.showUntil!
}

export function todayUTC(): number {
  const now = new Date()
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}

/** Checks for a newer deploy whenever the tab becomes visible again — no polling. */
function watchForNewBuild() {
  if (!import.meta.env.PROD) return
  const toast = () => document.querySelector<HTMLElement>('[data-update-toast]')
  document.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-update-reload]')) location.reload()
  })
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const response = await fetch('/build.json', { cache: 'no-store' })
      if (!response.ok) return
      const { buildId } = (await response.json()) as { buildId: string }
      if (buildId !== document.documentElement.dataset.build) toast()?.removeAttribute('hidden')
    } catch {
      // Offline: nothing to compare against.
    }
  })
}
