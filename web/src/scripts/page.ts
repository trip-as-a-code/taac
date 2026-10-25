// Per-navigation setup shared by every page (runs on `astro:page-load`).

const LANG_COOKIE = 'taac_lang'
let once = false

export function setupPage() {
  rememberLanguageOnSwitch()
  forgetOfflineCopiesOnLogout()
  trackScroll()
  renderRelativeDates()
  if (!once) {
    once = true
    registerServiceWorker()
    watchForNewBuild()
  }
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
