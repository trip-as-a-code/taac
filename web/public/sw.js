// Offline support: pages are network-first (fresh when online, cached when
// not); hashed assets are cache-first. API calls and other origins pass through.
const CACHE = 'taac-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Browser notifications from the server (Web Push): what others did in a
// discussion. A tap opens the page with that discussion, in a tab already
// open on the site if there is one.
self.addEventListener('push', (event) => {
  const message = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(message.title ?? 'taac', {
      body: message.body,
      tag: message.tag,
      data: { url: message.url ?? '/' },
      icon: '/icons/icon-192.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const tab = windows.find((w) => new URL(w.url).origin === location.origin)
      return tab ? tab.focus().then(() => tab.navigate(url)) : self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/build.json' || url.pathname.startsWith('/login')) return

  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
            return response
          }),
      ),
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Never cache a redirect to the login page as if it were the content.
        if (response.ok && !response.redirected)
          caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  )
})
