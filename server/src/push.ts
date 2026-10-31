/**
 * Browser notifications over Web Push: the browsers members turned them on
 * in, and what to tell them when someone else writes in a discussion. The
 * server signs with its VAPID key pair; without one there is no push.
 */

import webpush from 'web-push'

export interface PushSubscription {
  endpoint: string
  login: string
  p256dh: string
  auth: string
  /** The language to word notifications in. */
  lang: string
  createdAt: number
}

export interface PushStore {
  addSubscription(subscription: PushSubscription): Promise<void>
  removeSubscription(endpoint: string): Promise<void>
  subscriptionsFor(logins: string[]): Promise<PushSubscription[]>
}

export interface PushMessage {
  title: string
  body: string
  /** Opened on a tap. */
  url: string
  /** A newer message with the same tag replaces the older one. */
  tag: string
}

/** Delivers one message: `gone` when the browser dropped the subscription. */
export type PushSender = (subscription: PushSubscription, message: PushMessage) => Promise<'ok' | 'gone' | 'failed'>

export interface Vapid {
  publicKey: string
  privateKey: string
  /** A contact for push services: the site's address. */
  subject: string
}

export function vapidSender(vapid: Vapid): PushSender {
  return async (subscription, message) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(message),
        { vapidDetails: vapid, TTL: 24 * 60 * 60, urgency: 'normal' },
      )
      return 'ok'
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      return status === 404 || status === 410 ? 'gone' : 'failed'
    }
  }
}

/** A browser's subscription as `PushSubscription.toJSON()` gives it, or null. */
export function parseSubscription(value: unknown, login: string, lang: unknown, now: number): PushSubscription | null {
  const sub = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  if (typeof sub?.endpoint !== 'string' || !/^https:\/\/[^\s]{1,2000}$/.test(sub.endpoint)) return null
  const { p256dh, auth } = sub.keys ?? {}
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return null
  return {
    endpoint: sub.endpoint,
    login,
    p256dh,
    auth,
    lang: typeof lang === 'string' && /^[a-z]{2}$/.test(lang) ? lang : 'en',
    createdAt: now,
  }
}
