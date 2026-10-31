// Browser notifications on this device: turning them on (the browser's own
// permission, then a Web Push subscription the server keeps) or off, and when
// to offer them.

import type { Me } from '@/scripts/session'

const ASK_KEY = 'taac:push-ask'
const DAY = 24 * 60 * 60 * 1000

/** `home-screen`: an iPhone or iPad, where only a site added to the Home Screen gets notifications. */
export type PushState = 'unsupported' | 'home-screen' | 'denied' | 'on' | 'off'

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const appleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** The service worker that receives pushes: registered if it isn't yet, and given a few seconds to start. */
async function registration(): Promise<ServiceWorkerRegistration> {
  const found = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  if (found.active) return found
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('service worker')), 5000)),
  ])
}

async function subscription(): Promise<PushSubscription | null> {
  return (await registration()).pushManager.getSubscription()
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return appleMobile() && !standalone() ? 'home-screen' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off'
}

/** Asks the browser, subscribes, and tells the server; whether they are on now. */
export async function turnOn(publicKey: string): Promise<boolean> {
  if (!pushSupported()) return false
  if ((await Notification.requestPermission()) !== 'granted') return false
  const worker = await registration()
  const sub =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), lang: document.documentElement.lang }),
  })
  return response.ok
}

/** Off by choice: the prompt doesn't come back to offer them. */
export async function turnOff(): Promise<void> {
  postpone(true)
  const sub = pushSupported() ? await subscription().catch(() => null) : null
  if (!sub) return
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined)
  await sub.unsubscribe()
}

function asked(): { never?: boolean; until?: number } {
  try {
    return JSON.parse(localStorage.getItem(ASK_KEY) ?? '{}') as { never?: boolean; until?: number }
  } catch {
    return {}
  }
}

/** "Not now": a day; "never": until they turn them on from the bell. */
export function postpone(never: boolean) {
  try {
    localStorage.setItem(ASK_KEY, JSON.stringify(never ? { never: true } : { until: Date.now() + DAY }))
  } catch {
    // Then it asks again next time.
  }
}

let offered = false

/**
 * Offers notifications to a signed-in member once the page has settled,
 * unless the browser can't, they already chose, or they put it off; and keeps
 * the server's subscription in step when they are already on.
 */
export async function offerPush(session: Me | null) {
  if (offered || !session?.push || !pushSupported()) return
  offered = true
  if (Notification.permission === 'granted') {
    if (!(await subscription().catch(() => null))) await turnOn(session.push).catch(() => undefined)
    return
  }
  if (Notification.permission === 'denied') return
  const state = asked()
  if (state.never || (state.until ?? 0) > Date.now()) return
  const prompt = document.querySelector<HTMLDialogElement>('[data-push-prompt]')
  if (!prompt) return
  setTimeout(() => {
    // Not over another sheet.
    if (document.querySelector('dialog[open]')) return
    prompt.showModal()
  }, 4000)
  const publicKey = session.push
  prompt.querySelector('[data-push-allow]')!.addEventListener('click', async () => {
    prompt.close()
    // Whatever the browser answers, the choice is made: don't ask again here.
    postpone(true)
    await turnOn(publicKey).catch(() => undefined)
  })
  prompt.querySelector('[data-push-later]')!.addEventListener('click', () => {
    postpone(false)
    prompt.close()
  })
  prompt.querySelector('[data-push-never]')!.addEventListener('click', () => {
    postpone(true)
    prompt.close()
  })
  prompt.addEventListener('cancel', () => postpone(false))
}

/** Sends one notification to each of your browsers; how many got it. */
export async function testPush(): Promise<{ sent: number; of: number } | null> {
  const response = await fetch('/api/push/test', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: document.documentElement.lang }),
  }).catch(() => null)
  return response?.ok ? response.json() : null
}
