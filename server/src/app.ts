/**
 * The taac server in front of the built site. It owns signing in with
 * GitHub, who may see what (from /_taac/access.json, emitted by the web build
 * from site.yaml), calendar feeds that work without cookies, the remembered
 * UI language, `/api/fx`, packing ticks, the people's GitHub pictures, and
 * the security headers; and reminders of what is due.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  calendarSlug,
  decide,
  isProtected,
  localeRoot,
  localizedText,
  loginPath,
  mayTick,
  roleOf,
  sanitizeNext,
  splitLocale,
  tripOf,
  visibleTrips,
  type AccessManifest,
} from './access'
import {
  calendarKey,
  clearedCookie,
  LINK_COOKIE,
  linkCookie,
  randomState,
  readCookie,
  sameState,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sessionCookies,
  signSession,
  SIGNED_IN_COOKIE,
  STATE_COOKIE,
  stateCookie,
  verifySession,
} from './auth'
import { avatarLogin, avatarSource, mayShowAvatar } from './avatars'
import { photoRoute, photoSource, type PhotoEntry, type PhotoSize } from './photos'
import { parseSubscription, type PushMessage, type PushSender } from './push'
import {
  changeEvents,
  deadlineEvents,
  dueId,
  discussionEvents,
  isRead,
  KINDS,
  NOTIFICATION_LIMIT,
  page,
  type ChangeSet,
  type Kind,
} from './notifications'
import {
  currentReminder,
  openingWords,
  opensAt,
  dayIn,
  DEFAULT_REMIND_AT,
  rungTime,
  stillTimely,
  validRemindAt,
  validTimeZone,
  type Deadline,
  type DeadlineFile,
  type Reader,
  ticked,
} from './reminders'
import { commentsRoute, MAX_THREADS, newComment, newId, validAnchor, validBody, type CommentsRoute } from './comments'
import {
  describe,
  linkCookieAge,
  linksRoute,
  linkToken,
  MAX_LINKS,
  newLink,
  signLinkCookie,
  verifyLinkCookie,
  works,
  type ShareLink,
} from './links'
import { handleFx } from './fx'
import { authorizeUrl, userFor, type GithubApp } from './github'
import { robotsTxt, secureResponse } from './headers'
import { languageRedirect, pageLanguage, pushStrings } from './i18n'
import { renderForbiddenPage, renderLinkGonePage, renderLoginPage, type Theme } from './login-page'
import { packingSlug } from './packing'
import { serveStatic } from './static'
import type { Store } from './store'

/** What the build says about a trip for notifications (`trips/<slug>/threads.json`). */
interface TripDescription {
  title: string
  targets: Record<string, { title: string; href: string }>
  /** Member names by lowercase GitHub login. */
  people: Record<string, string>
  /** Renamed things' old anchors and their current ones. */
  moved?: Record<string, string>
}

export interface Config {
  /** The built site (`web/dist`). */
  dist: string
  /** Where the site answers, such as `https://trips.example.com`; else taken from each request. */
  publicUrl?: string
  sessionSecret?: string
  github?: GithubApp
  /** Shared state; without it the packing list is read-only. */
  store?: Store
  noindex?: boolean
  /** Browser notifications: the VAPID public key browsers subscribe with, and how to deliver. */
  push?: { publicKey: string; send: PushSender }
  fetcher?: typeof fetch
  now?: () => number
}

const nowSec = (config: Config): number => Math.floor((config.now?.() ?? Date.now()) / 1000)

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function redirect(location: string, status: 302 | 303, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(null, { status, headers })
}

/** The theme the viewer picked on the site; dark until they choose. */
function themeOf(request: Request): Theme {
  return readCookie(request.headers.get('Cookie'), 'taac_theme') === 'light' ? 'light' : 'dark'
}

export type Handler = ((request: Request) => Promise<Response>) & {
  /** Pushes the plan's changes members haven't heard of; for once the server has started. */
  announceChanges: () => Promise<void>
  /** Pushes the reminders that are due now; for every few minutes. */
  remind: () => Promise<void>
  /** Carries what hangs on renamed things over to their new anchors; for once the server has started. */
  moveAnchors: () => Promise<void>
}

export function createHandler(config: Config, manifest: AccessManifest): Handler {
  const origin = (request: Request) => config.publicUrl?.replace(/\/$/, '') ?? new URL(request.url).origin
  const secure = (request: Request) => origin(request).startsWith('https:')
  const ready = !isProtected(manifest) || (!!config.sessionSecret && !!config.github)
  const avatarOf = avatarSource(config.store, config.fetcher ?? fetch)
  const photoOf = photoSource(config.store, config.fetcher ?? fetch, `taac (+${config.publicUrl ?? 'self-hosted'})`)
  /** The photos the build lists (`/_taac/photos.json`), by id. */
  let photoIndex: Promise<Record<string, PhotoEntry>> | undefined
  const photos = () =>
    (photoIndex ??= readFile(join(config.dist, '_taac', 'photos.json'), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, PhotoEntry>)
      .catch((): Record<string, PhotoEntry> => ({})))

  async function loginOf(request: Request): Promise<string | null> {
    if (!config.sessionSecret) return null
    const session = await verifySession(
      readCookie(request.headers.get('Cookie'), SESSION_COOKIE),
      config.sessionSecret,
      nowSec(config),
    )
    return session?.login ?? null
  }

  /** Accounts' languages, read from the database at most every few seconds per account. */
  const accountLangs = new Map<string, { lang: string | null; until: number }>()
  async function accountLang(login: string | null): Promise<string | null> {
    if (!login || !config.store) return null
    const now = config.now?.() ?? Date.now()
    const hit = accountLangs.get(login)
    if (hit && hit.until > now) return hit.lang
    const lang = await config.store.userLang(login).catch(() => null)
    accountLangs.set(login, { lang, until: now + 5_000 })
    return lang
  }

  const language = (request: Request, path: string) =>
    pageLanguage(path, request.headers.get('Cookie'), request.headers.get('Accept-Language'), manifest)

  function startSignIn(request: Request, url: URL): Response {
    if (!config.github || !config.sessionSecret) return text('taac: signing in is not configured\n', 500)
    const next = sanitizeNext(url.searchParams.get('next'), '/')
    const state = randomState()
    const target = authorizeUrl(config.github, `${origin(request)}/api/auth/callback`, state)
    return redirect(target, 302, [stateCookie(`${state}|${encodeURIComponent(next)}`, secure(request))])
  }

  async function finishSignIn(request: Request, url: URL): Promise<Response> {
    if (!config.github || !config.sessionSecret) return text('taac: signing in is not configured\n', 500)
    const [state, rawNext] = (readCookie(request.headers.get('Cookie'), STATE_COOKIE) ?? '').split('|')
    const next = sanitizeNext(rawNext ? decodeURIComponent(rawNext) : null, '/')
    const failed = () => {
      const lang = language(request, next)
      const params = new URLSearchParams({ next, error: '1' })
      return redirect(`${loginPath(lang, manifest)}?${params}`, 303, [clearedCookie(STATE_COOKIE, secure(request))])
    }
    const code = url.searchParams.get('code')
    if (!code || !sameState(state ?? null, url.searchParams.get('state'))) return failed()
    const user = await userFor(config.github, code, `${origin(request)}/api/auth/callback`, config.fetcher).catch(
      () => null,
    )
    if (!user) return failed()
    const value = await signSession(config.sessionSecret, { login: user.login, exp: nowSec(config) + SESSION_MAX_AGE })
    // Their language comes from the account on every page from now on.
    return redirect(next, 303, [
      ...sessionCookies(value, secure(request)),
      clearedCookie(STATE_COOKIE, secure(request)),
    ])
  }

  function signOut(request: Request): Response {
    return redirect('/', 303, [
      clearedCookie(SESSION_COOKIE, secure(request)),
      clearedCookie(SIGNED_IN_COOKIE, secure(request)),
    ])
  }

  /** Links checked in the last half minute, so a page's many requests ask the database once. */
  const checked = new Map<string, { link: ShareLink | null; until: number }>()

  /** The view-only link this browser opened, while it still works. */
  async function linkOf(request: Request): Promise<ShareLink | null> {
    if (!config.store || !config.sessionSecret) return null
    const cookie = await verifyLinkCookie(readCookie(request.headers.get('Cookie'), LINK_COOKIE), config.sessionSecret)
    if (!cookie || !manifest.slugs.includes(cookie.trip)) return null
    const now = config.now?.() ?? Date.now()
    let hit = checked.get(cookie.id)
    if (!hit || hit.until < now) {
      hit = { link: await config.store.linkById(cookie.id), until: now + 30_000 }
      checked.set(cookie.id, hit)
    }
    return works(hit.link, now) && hit.link.trip === cookie.trip ? hit.link : null
  }

  /** The trips a request may see: its account's, and its link's. */
  function tripsFor(login: string | null, link: ShareLink | null): string[] {
    const trips = visibleTrips(login, manifest)
    return link && !trips.includes(link.trip) ? [...trips, link.trip] : trips
  }

  /** Who may make and revoke a trip's links: its `member`s, when there is somewhere to keep them. */
  const mayShare = (slug: string, login: string | null) => !!config.store && roleOf(slug, login, manifest) === 'member'

  /** What the build wrote for a trip in a language: `threads.json` (titles, anchors, people) and `changes.json`. */
  const built = new Map<string, Promise<unknown>>()
  function readBuilt<T>(slug: string, lang: string, file: string): Promise<T | null> {
    const key = `${lang}/${slug}/${file}`
    let found = built.get(key)
    if (!found) {
      const prefix = lang === manifest.defaultLocale ? '' : lang
      found = readFile(join(config.dist, prefix, 'trips', slug, file), 'utf8')
        .then((text) => JSON.parse(text) as T)
        .catch(() => null)
      built.set(key, found)
    }
    return found as Promise<T | null>
  }
  const describeTrip = (slug: string, lang: string) => readBuilt<TripDescription>(slug, lang, 'threads.json')
  const changesOf = async (slug: string, lang: string) =>
    (await readBuilt<{ sets: ChangeSet[] }>(slug, lang, 'changes.json'))?.sets ?? []
  const deadlinesOf = (slug: string) => readBuilt<DeadlineFile>(slug, manifest.defaultLocale, 'deadlines.json')

  /** Where someone is and when they want reminders; where the trip is until a browser of theirs says. */
  async function readerOf(login: string, fallbackZone: string): Promise<Reader & { known: boolean }> {
    const { timeZone, remindAt } = (await config.store?.userReminders(login)) ?? { timeZone: null, remindAt: null }
    return { timeZone: timeZone ?? fallbackZone, remindAt: remindAt ?? DEFAULT_REMIND_AT, known: !!timeZone }
  }

  /**
   * Sends `kind` to the trip's other members' browsers, worded per browser by
   * `message` in the language they chose (else the one the browser had),
   * except to those who turned that kind off.
   */
  async function pushToMembers(
    slug: string,
    by: string | undefined,
    kind: Kind,
    message: (lang: string) => Promise<PushMessage>,
  ) {
    const push = config.push
    if (!push || !config.store) return
    const store = config.store
    const others = Object.keys(manifest.trips[slug]?.roles ?? {}).filter((login) => login !== by)
    const settings = new Map(
      await Promise.all(
        others.map(
          async (login) => [login, { lang: await store.userLang(login), muted: await store.userMuted(login) }] as const,
        ),
      ),
    )
    for (const sub of await store.subscriptionsFor(others)) {
      const chosen = settings.get(sub.login)
      if (chosen?.muted.includes(kind)) continue
      const result = await push.send(sub, await message(chosen?.lang ?? sub.lang))
      if (result === 'gone') await store.removeSubscription(sub.endpoint)
    }
  }

  /** Tells the trip's other members' browsers what `by` just did in a discussion. */
  async function announce(
    slug: string,
    by: string,
    kind: 'thread' | 'reply' | 'resolved',
    thread: string,
    anchor: string,
    said: string,
  ) {
    await pushToMembers(slug, by, kind, async (lang) => {
      const trip = await describeTrip(slug, lang)
      const target = trip?.targets[anchor]
      const what = pushStrings(lang)[kind].replace('{name}', trip?.people[by] ?? `@${by}`)
      const [page, hash] = (target?.href ?? `/trips/${slug}/`).split('#')
      return {
        title: target?.title ?? trip?.title ?? slug,
        body: said ? `${what}: ${said.length > 180 ? `${said.slice(0, 179)}…` : said}` : what,
        url: `${page}?thread=${encodeURIComponent(anchor)}${hash ? `#${hash}` : ''}`,
        tag: `thread:${thread}`,
      }
    })
  }

  /**
   * After a deploy: tells members about the plan's changes they haven't heard
   * of (from the last week). The first time, it only takes note of them.
   */
  async function announceChanges(): Promise<void> {
    const store = config.store
    if (!store) return
    const now = config.now?.() ?? Date.now()
    for (const slug of manifest.slugs) {
      const sets = await changesOf(slug, manifest.defaultLocale)
      const { fresh, first } = await store.unannounced(
        slug,
        sets.map((s) => s.id),
      )
      if (first) continue
      for (const set of sets.filter((s) => fresh.includes(s.id) && s.at > now - 7 * 24 * 60 * 60 * 1000))
        await pushToMembers(slug, set.login, 'change', async (lang) => {
          const trip = await describeTrip(slug, lang)
          const worded = (await changesOf(slug, lang)).find((s) => s.id === set.id) ?? set
          const strings = pushStrings(lang)
          const name = set.login ? (trip?.people[set.login] ?? `@${set.login}`) : set.author
          return {
            title: trip?.title ?? slug,
            body: `${name ? strings.change.replace('{name}', name) : strings.changeAnon}: ${worded.summary}`,
            url: worded.href,
            tag: `change:${set.id}`,
          }
        })
    }
  }

  /**
   * The push for one thing that's due: titled by it, saying when, opening it.
   * Its tag is the thing's own, so a later reminder replaces the earlier one
   * and never another thing's.
   */
  async function dueMessage(
    slug: string,
    d: Deadline,
    lang: string,
    now: number,
    reader: Reader,
    tripZone: string,
  ): Promise<PushMessage> {
    const trip = await describeTrip(slug, lang)
    const strings = pushStrings(lang)
    const target = trip?.targets[d.anchor]
    const opens = d.ladder === 'opens' ? opensAt(d, tripZone) : undefined
    if (opens !== undefined) {
      const { day, time } = openingWords(opens, now, lang, reader.timeZone)
      return {
        title: target?.title ?? trip?.title ?? slug,
        body: (now < opens ? strings.opens : strings.opened).replace('{day}', day).replace('{time}', time),
        url: target?.href ?? `/trips/${slug}/`,
        tag: `due:${slug}:${d.key}`,
      }
    }
    const days = Math.round((Date.parse(d.date) - Date.parse(dayIn(now, reader.timeZone))) / 86_400_000)
    const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      Date.parse(d.date),
    )
    const rel = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day')
    return {
      title: target?.title ?? trip?.title ?? slug,
      body: (days < 0 ? strings.overdue : strings.due)[d.kind].replace('{rel}', rel).replace('{date}', date),
      url: target?.href ?? `/trips/${slug}/`,
      tag: `due:${slug}:${d.key}`,
    }
  }

  /**
   * Reminds each trip person of what is due now, by its ladder, at their time
   * where they are: a push per thing, never the same reminder twice. Someone
   * whose browsers haven't said where they are waits until one does.
   */
  async function remind(): Promise<void> {
    const { push, store } = config
    if (!push || !store) return
    const now = config.now?.() ?? Date.now()
    for (const slug of manifest.slugs) {
      const file = await deadlinesOf(slug)
      if (!file?.deadlines.length) continue
      const ticks = await store.ticks(slug)
      for (const login of Object.keys(manifest.trips[slug]?.roles ?? {})) {
        // A task ticked done on the site no longer reminds.
        const theirs = file.deadlines.filter((d) => d.logins.includes(login) && !ticked(d, login, ticks))
        if (!theirs.length) continue
        const reader = await readerOf(login, file.timezone)
        if (!reader.known) continue
        const muted = await store.userMuted(login)
        const [seenAt, marks] = await Promise.all([store.notificationsSeen(login), store.notificationMarks(login)])
        const due: Deadline[] = []
        for (const d of theirs) {
          if (muted.includes(d.kind)) continue
          const reminder = currentReminder(d, now, file.timezone, reader)
          if (!reminder || !stillTimely(reminder, now)) continue
          // Already read in the list, which showed it as soon as it came: by
          // the trip's clock until this account's browser said where it is,
          // so reading everything then covers it too. Claimed, not pushed.
          const shown = Math.min(
            reminder.at,
            rungTime(d, reminder.rung, file.timezone, { ...reader, timeZone: file.timezone }),
          )
          const read = isRead({ id: dueId(d, reminder.rung), at: shown }, seenAt, marks)
          if ((await store.claimReminder(login, `${slug}/${d.key}`, d.date, reminder.rung, now)) && !read) due.push(d)
        }
        if (!due.length) continue
        const lang = await store.userLang(login)
        for (const sub of await store.subscriptionsFor([login]))
          for (const d of due) {
            const result = await push.send(sub, await dueMessage(slug, d, lang ?? sub.lang, now, reader, file.timezone))
            if (result === 'gone') {
              await store.removeSubscription(sub.endpoint)
              break
            }
          }
      }
    }
  }

  /** `POST /api/me/reminders`: where the account is (`timeZone`, from its browser) and when it wants reminders (`remindAt`). */
  async function setReminders(request: Request): Promise<Response> {
    if (!config.store || request.method !== 'POST') return text('Not found\n', 404)
    const login = await loginOf(request)
    if (!login) return text('Unauthorized\n', 401)
    const body = (await request.json().catch(() => ({}))) as { timeZone?: unknown; remindAt?: unknown }
    const { timeZone, remindAt } = body
    if ((timeZone !== undefined && !validTimeZone(timeZone)) || (remindAt !== undefined && !validRemindAt(remindAt)))
      return text('Bad request\n', 400)
    await config.store.setUserReminders(login, { timeZone, remindAt })
    return json(await config.store.userReminders(login))
  }

  /**
   * After a deploy: anchors come from titles, so a renamed thing's discussions,
   * ticks, reminders and marks move to its new one, as the build worked out
   * from history.
   */
  async function moveAnchors(): Promise<void> {
    const store = config.store
    if (!store) return
    for (const slug of manifest.slugs)
      for (const [from, to] of Object.entries((await describeTrip(slug, manifest.defaultLocale))?.moved ?? {}))
        if (validAnchor(from) && validAnchor(to)) {
          const moved = await store.moveAnchor(slug, from, to)
          if (moved) console.log(`taac: ${slug}: ${moved} record(s) moved from ${from} to ${to}`)
        }
  }

  /** `POST /api/me/notifications`: the notification kinds the account turned off (`{muted}`). */
  async function setMuted(request: Request): Promise<Response> {
    if (!config.store || request.method !== 'POST') return text('Not found\n', 404)
    const login = await loginOf(request)
    if (!login) return text('Unauthorized\n', 401)
    const body = (await request.json().catch(() => ({}))) as { muted?: unknown }
    if (!Array.isArray(body.muted)) return text('Bad request\n', 400)
    const muted = KINDS.filter((kind) => (body.muted as unknown[]).includes(kind))
    await config.store.setUserMuted(login, muted)
    return json({ muted })
  }

  /** `POST /api/me/lang`: the signed-in account's language, kept for every browser and its notifications. */
  async function setLang(request: Request): Promise<Response> {
    if (!config.store || request.method !== 'POST') return text('Not found\n', 404)
    const login = await loginOf(request)
    if (!login) return text('Unauthorized\n', 401)
    const body = (await request.json().catch(() => ({}))) as { lang?: unknown }
    if (typeof body.lang !== 'string' || !manifest.locales.includes(body.lang)) return text('Bad request\n', 400)
    await config.store.setUserLang(login, body.lang)
    accountLangs.set(login, { lang: body.lang, until: (config.now?.() ?? Date.now()) + 5_000 })
    return json({ lang: body.lang })
  }

  /** Fire and forget: a slow push service never holds up the answer. */
  const tell = (...args: Parameters<typeof announce>) => void announce(...args).catch((error) => console.error(error))

  /**
   * `/api/push/subscribe` and `/api/push/unsubscribe`: this browser's
   * notifications, on or off; `/api/push/test`: one to each of your browsers.
   */
  async function pushApi(request: Request, path: string): Promise<Response> {
    if (!config.push || !config.store || request.method !== 'POST') return text('Not found\n', 404)
    const login = await loginOf(request)
    if (!login) return text('Unauthorized\n', 401)
    if (!manifest.slugs.some((slug) => mayComment(slug, login))) return text('Forbidden\n', 403)
    const body = (await request.json().catch(() => ({}))) as {
      subscription?: unknown
      endpoint?: unknown
      lang?: unknown
    }
    if (path === '/api/push/subscribe') {
      const sub = parseSubscription(body.subscription, login, body.lang, config.now?.() ?? Date.now())
      if (!sub) return text('Bad request\n', 400)
      await config.store.addSubscription(sub)
      return json({ ok: true })
    }
    if (path === '/api/push/test') {
      const subs = await config.store.subscriptionsFor([login])
      const lang = typeof body.lang === 'string' ? body.lang : manifest.defaultLocale
      const strings = pushStrings(lang)
      let sent = 0
      const chosen = await config.store.userLang(login)
      for (const sub of subs) {
        const subLang = chosen ?? sub.lang
        const result = await config.push.send(sub, {
          title: pushStrings(subLang).testTitle,
          body: pushStrings(subLang).test,
          url: localeRoot(subLang === manifest.defaultLocale ? null : subLang, manifest),
          tag: 'test',
        })
        if (result === 'ok') sent++
        if (result === 'gone') await config.store.removeSubscription(sub.endpoint)
      }
      return json({ sent, of: subs.length, message: strings.test })
    }
    if (typeof body.endpoint !== 'string') return text('Bad request\n', 400)
    await config.store.removeSubscription(body.endpoint)
    return json({ ok: true })
  }

  /** Who may write in a trip's discussions: its members, whatever their role. */
  const mayComment = (slug: string, login: string | null) => !!config.store && roleOf(slug, login, manifest) !== null

  /** Who is signed in, which trips they see, tick and share, their calendar keys, and the link they came by. */
  async function me(request: Request): Promise<Response> {
    const login = await loginOf(request)
    const link = await linkOf(request)
    const trips = tripsFor(login, link)
    const calendars: Record<string, string> = {}
    // A link holder gets no calendar key: keys don't expire, links do.
    if (config.sessionSecret && (login || !isProtected(manifest)))
      for (const slug of visibleTrips(login, manifest)) calendars[slug] = await calendarKey(config.sessionSecret, slug)
    const packing = manifest.slugs.filter((slug) => mayTick(slug, login, manifest))
    const share = manifest.slugs.filter((slug) => mayShare(slug, login))
    const comments = manifest.slugs.filter((slug) => mayComment(slug, login))
    const lang = login && config.store ? await config.store.userLang(login).catch(() => null) : null
    return json({
      login,
      trips,
      packing,
      share,
      comments,
      calendars,
      link: link ? { trip: link.trip, label: link.label, expiresAt: link.expiresAt } : null,
      push: config.push && config.store && login && comments.length ? config.push.publicKey : null,
      browsers: config.push && config.store && login ? (await config.store.subscriptionsFor([login])).length : 0,
      lang,
      muted: login && config.store ? await config.store.userMuted(login).catch(() => []) : [],
      ...(login && config.store
        ? await config.store.userReminders(login).catch(() => ({ timeZone: null, remindAt: null }))
        : { timeZone: null, remindAt: null }),
    })
  }

  /** `/s/<token>`: remembers the link in this browser and opens its trip. */
  async function openLink(request: Request, token: string): Promise<Response> {
    const now = config.now?.() ?? Date.now()
    const link = config.store ? await config.store.linkByToken(token) : null
    const lang = language(request, '/')
    if (!works(link, now) || !config.sessionSecret || !manifest.slugs.includes(link.trip))
      return html(
        renderLinkGonePage({
          lang,
          title: localizedText(manifest.title, lang),
          signIn: loginPath(lang === manifest.defaultLocale ? null : lang, manifest),
          theme: themeOf(request),
          // One address in every language: the cookie picks it.
          switches: { langs: manifest.locales.map((l) => ({ lang: l, href: new URL(request.url).pathname })) },
        }),
        410,
      )
    await config.store!.touchLink(link.id, now).catch(() => undefined)
    const cookie = await signLinkCookie(config.sessionSecret, link)
    const home = localeRoot(lang === manifest.defaultLocale ? null : lang, manifest)
    return redirect(`${home}trips/${encodeURIComponent(link.trip)}/`, 303, [
      linkCookie(cookie, secure(request), linkCookieAge(link, now)),
    ])
  }

  /**
   * A trip's discussions: its members read and write; someone who came by
   * the trip's link reads. Every change answers with all the trip's threads.
   */
  async function discussions(request: Request, route: CommentsRoute): Promise<Response> {
    const store = config.store
    if (!manifest.slugs.includes(route.slug) || !store) return text('Not found\n', 404)
    const login = await loginOf(request)
    const writer = mayComment(route.slug, login)
    const reader = writer || (await linkOf(request))?.trip === route.slug
    if (!reader) return text(login ? 'Forbidden\n' : 'Unauthorized\n', login ? 403 : 401)
    // Signed in, which threads have something new from others for this
    // account, as the bell has it: on every device, and nothing of a kind
    // they turned off (the bell never lists it, so it could never be read).
    const all = async () => {
      const threads = await store.threads(route.slug)
      if (!writer || !login) return json({ threads })
      const [seenAt, marks, muted] = await Promise.all([
        store.notificationsSeen(login),
        store.notificationMarks(login),
        store.userMuted(login),
      ])
      const unread = new Set(
        discussionEvents(route.slug, threads, login)
          .filter((n) => n.kind !== 'resolved' && !muted.includes(n.kind) && !isRead(n, seenAt, marks))
          .map((n) => n.thread),
      )
      return json({ threads, unread: [...unread] })
    }
    if (request.method === 'GET' && route.kind === 'threads') return all()
    if (!writer || !login) return text('Only the trip’s people comment\n', 403)
    const now = config.now?.() ?? Date.now()
    const body = (await request.json().catch(() => ({}))) as { anchor?: unknown; body?: unknown; resolved?: unknown }
    const bad = () => text('Bad request\n', 400)

    if (route.kind === 'threads' && request.method === 'POST') {
      const textBody = validBody(body.body)
      if (!validAnchor(body.anchor) || !textBody) return bad()
      if ((await store.threads(route.slug)).length >= MAX_THREADS) return text('Too many threads\n', 409)
      const id = newId()
      await store.createThread({
        id,
        trip: route.slug,
        anchor: body.anchor,
        createdBy: login,
        createdAt: now,
        resolvedAt: null,
        resolvedBy: null,
        comments: [newComment(login, textBody, now)],
      })
      tell(route.slug, login, 'thread', id, body.anchor, textBody)
      return all()
    }
    if (route.kind === 'replies' || route.kind === 'thread') {
      const thread = await store.thread(route.id)
      if (thread?.trip !== route.slug) return text('Not found\n', 404)
      if (route.kind === 'replies' && request.method === 'POST') {
        const textBody = validBody(body.body)
        if (!textBody) return bad()
        await store.addComment(thread.id, newComment(login, textBody, now))
        tell(route.slug, login, 'reply', thread.id, thread.anchor, textBody)
        return all()
      }
      if (route.kind === 'thread' && request.method === 'PATCH') {
        if (typeof body.resolved !== 'boolean') return bad()
        await store.resolveThread(thread.id, body.resolved ? login : null, now)
        if (body.resolved) tell(route.slug, login, 'resolved', thread.id, thread.anchor, '')
        return all()
      }
    }
    if (route.kind === 'comment' && (request.method === 'PATCH' || request.method === 'DELETE')) {
      const comment = await store.comment(route.id)
      if (comment?.trip !== route.slug || comment.deletedAt !== null) return text('Not found\n', 404)
      if (comment.author !== login) return text('Only its author changes a comment\n', 403)
      if (request.method === 'DELETE') await store.deleteComment(comment.id, now)
      else {
        const textBody = validBody(body.body)
        if (!textBody) return bad()
        await store.editComment(comment.id, textBody, now)
      }
      return all()
    }
    return text('Method not allowed\n', 405)
  }

  /**
   * `/api/notifications`: what others did on your trips, newest first, a page
   * at a time (`?before=<ms>&limit=<n>&unread=1`), each read or not, and how
   * many are unread. POST `/read` with `{all}`, `{ids}` or `{threads}`, and
   * POST `/unread` with `{ids}`, mark them.
   */
  async function notifications(request: Request, path: string): Promise<Response> {
    const store = config.store
    if (!store) return text('Not found\n', 404)
    const login = await loginOf(request)
    if (!login) return text('Unauthorized\n', 401)
    const now = config.now?.() ?? Date.now()
    const trips = manifest.slugs.filter((slug) => mayComment(slug, login))
    const muted = new Set<string>(await store.userMuted(login))
    const events = (
      await Promise.all(
        trips.map(async (slug) => {
          const deadlines = await deadlinesOf(slug)
          return [
            ...discussionEvents(slug, await store.threads(slug), login),
            ...changeEvents(slug, await changesOf(slug, manifest.defaultLocale), login),
            ...(deadlines
              ? deadlineEvents(
                  slug,
                  deadlines,
                  login,
                  now,
                  await readerOf(login, deadlines.timezone),
                  await store.ticks(slug),
                )
              : []),
          ]
        }),
      )
    )
      .flat()
      .filter((n) => !muted.has(n.kind))
    const state = async () => {
      const [seenAt, marks] = await Promise.all([store.notificationsSeen(login), store.notificationMarks(login)])
      return { seenAt, marks, unread: events.filter((n) => !isRead(n, seenAt, marks)).length }
    }
    if (request.method === 'POST' && (path === '/api/notifications/read' || path === '/api/notifications/unread')) {
      const body = (await request.json().catch(() => ({}))) as { all?: unknown; ids?: unknown; threads?: unknown }
      const strings = (value: unknown) =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 500) : []
      if (path === '/api/notifications/read' && body.all === true) await store.markNotificationsSeen(login, now)
      else {
        const threads = new Set(strings(body.threads))
        const known = new Set(events.map((n) => n.id))
        // A thread that was read is read whole, kinds turned off included:
        // turned back on, they don't come back as new.
        const discussed = threads.size
          ? (
              await Promise.all(trips.map(async (slug) => discussionEvents(slug, await store.threads(slug), login)))
            ).flat()
          : []
        const ids = [
          ...strings(body.ids).filter((id) => known.has(id)),
          ...discussed.filter((n) => threads.has(n.thread)).map((n) => n.id),
        ]
        await store.markNotifications(login, ids, path === '/api/notifications/read')
      }
      return json({ unread: (await state()).unread })
    }
    if (path !== '/api/notifications' || request.method !== 'GET') return text('Not found\n', 404)
    const url = new URL(request.url)
    const before = Number(url.searchParams.get('before')) || undefined
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || NOTIFICATION_LIMIT, 1), NOTIFICATION_LIMIT)
    const { seenAt, marks, unread } = await state()
    const wanted = url.searchParams.get('unread') === '1' ? events.filter((n) => !isRead(n, seenAt, marks)) : events
    const items = page(wanted, limit + 1, before)
    return json({
      unread,
      notifications: items.slice(0, limit).map((n) => ({ ...n, read: isRead(n, seenAt, marks) })),
      more: items.length > limit,
    })
  }

  /** `/api/trips/<slug>/links`: the trip's working links (GET), a new one (POST), revoking one (DELETE). */
  async function links(request: Request, slug: string, id: string | null): Promise<Response> {
    const login = await loginOf(request)
    if (!manifest.slugs.includes(slug) || !config.store) return text('Not found\n', 404)
    if (!login) return text('Unauthorized\n', 401)
    if (!mayShare(slug, login)) return text('Only the trip’s members share it\n', 403)
    const now = config.now?.() ?? Date.now()
    const list = async () =>
      json({ links: (await config.store!.links(slug, now)).map((l) => describe(l, origin(request))) })
    if (request.method === 'GET' && !id) return list()
    if (request.method === 'POST' && !id) {
      const body = (await request.json().catch(() => ({}))) as { label?: unknown; expires?: unknown }
      const link = newLink(slug, body.label, body.expires, login, now)
      if (!link) return text('expected {label, expires: 1d|1w|1m|never}\n', 400)
      if ((await config.store.links(slug, now)).length >= MAX_LINKS) return text('Too many links\n', 409)
      await config.store.createLink(link)
      return list()
    }
    if (request.method === 'DELETE' && id) {
      if (!(await config.store.revokeLink(slug, id, login, now))) return text('Not found\n', 404)
      checked.delete(id)
      return list()
    }
    return text('Method not allowed\n', 405)
  }

  /** Unlocks the calendar feed for subscribers, who cannot sign in. */
  async function calendarKeyValid(path: string, url: URL): Promise<boolean> {
    const slug = calendarSlug(path)
    const key = url.searchParams.get('key')
    if (!slug || !key || !config.sessionSecret) return false
    return key === (await calendarKey(config.sessionSecret, slug))
  }

  /** A place's photo in a size, or 404 so the page keeps its icon. */
  async function photo(request: Request, id: string, size: PhotoSize): Promise<Response> {
    const none = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } })
    const entry = (await photos())[id]
    if (!entry) return none()
    const visible = tripsFor(await loginOf(request), await linkOf(request))
    if (!entry.trips.some((slug) => visible.includes(slug))) return none()
    const found = await photoOf(id, entry.url, size, config.now?.() ?? Date.now())
    if (!found) return none()
    // The id is the URL's hash: a new picture is a new id.
    return new Response(found.image, {
      headers: { 'Content-Type': found.type, 'Cache-Control': 'private, max-age=2592000, immutable' },
    })
  }

  /** A trip person's GitHub picture, or 404 so the site keeps their initials. */
  async function avatar(request: Request, login: string): Promise<Response> {
    const none = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } })
    if (!mayShowAvatar(login, tripsFor(await loginOf(request), await linkOf(request)), manifest)) return none()
    const found = await avatarOf(login, config.now?.() ?? Date.now())
    if (!found?.image || !found.type) return none()
    return new Response(found.image, {
      headers: { 'Content-Type': found.type, 'Cache-Control': 'private, max-age=86400' },
    })
  }

  async function packing(request: Request, slug: string): Promise<Response> {
    if (!config.store || !manifest.slugs.includes(slug)) return text('Not found\n', 404)
    if (request.method === 'POST') {
      const login = await loginOf(request)
      if (!mayTick(slug, login, manifest)) return text('Only the trip’s people tick\n', 403)
      const body = (await request.json().catch(() => ({}))) as { changes?: unknown }
      await config.store.apply(slug, body.changes, config.now?.() ?? Date.now(), login)
    } else if (request.method !== 'GET') return text('Method not allowed\n', 405)
    return json({ ticks: await config.store.ticks(slug) })
  }

  async function route(request: Request): Promise<{ response: Response; underProtection: boolean }> {
    const url = new URL(request.url)
    const path = url.pathname
    const plain = (response: Response) => ({ response, underProtection: false })
    const noindex = isProtected(manifest) || config.noindex === true

    if (path === '/healthz') return plain(text('ok\n', 200))
    if (path.startsWith('/_taac/')) return plain(text('Not found\n', 404))
    if (path === '/robots.txt') return plain(text(robotsTxt(noindex), 200))

    // Before the language redirect: a link is one address, in any language.
    const token = linkToken(path)
    if (token) return plain(await openLink(request, token))

    const pageRequest = request.method === 'GET' && Boolean(request.headers.get('Accept')?.includes('text/html'))
    const languageTarget = languageRedirect(
      {
        method: request.method,
        path,
        search: url.search,
        accept: request.headers.get('Accept'),
        cookie: request.headers.get('Cookie'),
        acceptLanguage: request.headers.get('Accept-Language'),
      },
      manifest,
      pageRequest ? await accountLang(await loginOf(request)) : null,
    )
    if (languageTarget) return plain(redirect(languageTarget, 302))

    if (path === '/api/auth/github') return plain(startSignIn(request, url))
    if (path === '/api/auth/callback') return plain(await finishSignIn(request, url))
    if (path === '/api/logout')
      return plain(request.method === 'POST' ? signOut(request) : text('Method not allowed\n', 405))
    if (path === '/api/me') return plain(await me(request))
    if (path === '/api/me/lang') return plain(await setLang(request))
    if (path === '/api/me/notifications') return plain(await setMuted(request))
    if (path === '/api/me/reminders') return plain(await setReminders(request))
    if (path === '/api/push/subscribe' || path === '/api/push/unsubscribe' || path === '/api/push/test')
      return plain(await pushApi(request, path))
    if (path === '/api/notifications' || path === '/api/notifications/read' || path === '/api/notifications/unread')
      return plain(await notifications(request, path))
    const commentsApi = commentsRoute(path)
    if (commentsApi) return plain(await discussions(request, commentsApi))
    const linkApi = linksRoute(path)
    if (linkApi) return plain(await links(request, linkApi.slug, linkApi.id))
    const pictureOfPlace = photoRoute(path)
    if (pictureOfPlace) return plain(await photo(request, pictureOfPlace.id, pictureOfPlace.size))
    const pictured = avatarLogin(path)
    if (pictured) return plain(await avatar(request, pictured))

    const { locale, rest } = splitLocale(path, manifest)
    if (rest === '/login') {
      const lang = language(request, path)
      const next = sanitizeNext(url.searchParams.get('next'), localeRoot(lang, manifest))
      if (!isProtected(manifest) || (await loginOf(request))) return plain(redirect(next, 302))
      return plain(
        html(
          renderLoginPage({
            lang,
            title: localizedText(manifest.title, lang),
            next,
            error: url.searchParams.get('error') === '1',
            theme: themeOf(request),
            switches: { langs: manifest.locales.map((l) => ({ lang: l, href: loginPath(l, manifest) + url.search })) },
          }),
        ),
      )
    }

    const login = await loginOf(request)
    let decision = decide(path, login, manifest)
    if (decision !== 'open' && (await calendarKeyValid(path, url))) decision = 'open'
    if (decision !== 'open') {
      // A link opens its own trip and what its pages load, never another trip
      // or the list of them: the home page sends it to its trip.
      const link = await linkOf(request)
      const slug = tripOf(path, manifest)
      if (link && slug === link.trip) decision = 'open'
      else if (link && slug === null) {
        if (rest === '/')
          return plain(redirect(`${localeRoot(locale, manifest)}trips/${encodeURIComponent(link.trip)}/`, 302))
        decision = 'open'
      }
    }
    if (decision !== 'open' && !ready)
      return plain(text('taac: signing in is configured but its secrets are missing\n', 500))
    if (decision === 'sign-in') {
      if (request.headers.get('Accept')?.includes('text/html')) {
        const params = new URLSearchParams({ next: path + url.search })
        return plain(redirect(`${loginPath(locale, manifest)}?${params}`, 302))
      }
      return plain(text('Unauthorized\n', 401))
    }
    if (decision === 'forbidden') {
      if (request.headers.get('Accept')?.includes('text/html')) {
        const lang = language(request, path)
        const slug = tripOf(path, manifest)
        return plain(
          html(
            renderForbiddenPage({
              lang,
              title: slug ? (manifest.trips[slug]?.title ?? slug) : localizedText(manifest.title, lang),
              login: login ?? '',
              trip: slug !== null,
              home: localeRoot(locale, manifest),
              theme: themeOf(request),
              switches: {
                langs: manifest.locales.map((l) => ({
                  lang: l,
                  href: localeRoot(l, manifest) + rest.slice(1) + url.search,
                })),
                account: true,
              },
            }),
            403,
          ),
        )
      }
      return plain(text('Forbidden\n', 403))
    }

    const underProtection = isProtected(manifest) && !manifest.trips[tripOf(path, manifest) ?? '']?.public
    if (path === '/api/fx') return { response: await handleFx(url, config.fetcher), underProtection }
    const slug = packingSlug(path)
    if (slug) return { response: await packing(request, slug), underProtection }
    return { response: await serveStatic(config.dist, request), underProtection }
  }

  const handle = async (request: Request) => {
    const url = new URL(request.url)
    const { response, underProtection } = await route(request)
    return secureResponse(response, {
      https: secure(request),
      noindex: isProtected(manifest) || config.noindex === true,
      path: url.pathname,
      siteProtected: isProtected(manifest),
      underProtection,
    })
  }
  return Object.assign(handle, { announceChanges, remind, moveAnchors })
}
