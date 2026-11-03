// Ids come from titles, so a rename gives a thing a new anchor; old links (a
// bookmark, a notification, a link someone shared) still name the old one.
// The build lists where each went (`moved` in the trip's threads.json).

/** The anchor prefix of each page's element ids: `#item-<id>` is `item:<id>`. */
const HASHES = ['item', 'idea', 'task', 'pass', 'packing'] as const

let moved: Promise<Record<string, string>> | undefined
let movedFor = ''

function movedHere(): Promise<Record<string, string>> {
  const trip = /^(.*\/trips\/[^/]+\/)/.exec(location.pathname)?.[1]
  if (!trip) return Promise.resolve({})
  if (!moved || movedFor !== trip) {
    movedFor = trip
    moved = fetch(`${trip}threads.json`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((body: { moved?: Record<string, string> }) => body.moved ?? {})
      .catch(() => ({}))
  }
  return moved
}

/** Where an anchor is now, if its thing was renamed. */
export async function currentAnchor(anchor: string): Promise<string> {
  return (await movedHere())[anchor] ?? anchor
}

/** Where an element id from a link (`item-<id>`, …) is now, if its thing was renamed; null if it wasn't. */
export async function currentHash(id: string): Promise<string | null> {
  const kind = HASHES.find((k) => id.startsWith(`${k}-`))
  if (!kind) return null
  const to = (await movedHere())[`${kind}:${id.slice(kind.length + 1)}`]
  return to ? `${kind}-${to.slice(kind.length + 1)}` : null
}
