// The people lens: one selection of travellers that every trip page follows.
// Lives in the URL (`?who=a,b&mode=together`, shareable) and is remembered per
// trip on this device, so it carries across pages. Plans nobody was assigned
// to sit apart: hidden from every selection, shown alone with `?unassigned`.
// Pages without plans (budget, packing) don't offer it.

export type LensMode = 'any' | 'together'

export interface Lens {
  people: string[]
  mode: LensMode
  /** Only plans without a `who`; `people` is empty then. */
  unassigned?: boolean
}

const EVENT = 'taac:lens'
let current: Lens = { people: [], mode: 'any' }
let trip = ''
// Client-side navigation keeps `document`; the lens element is new per page.
let readFrom: Element | null | undefined

const storageKey = () => `taac:lens:${trip}`

/** The lens for the current page, read once per page from `[data-lens]`. */
export function getLens(): Lens {
  const root = document.querySelector<HTMLElement>('[data-lens]')
  if (readFrom !== root) {
    readFrom = root
    if (root)
      initLens(root.dataset.lens!, (root.dataset.members ?? '').split(' '), root.hasAttribute('data-unassigned'))
    else current = { people: [], mode: 'any' }
  }
  return current
}

/** Reads the lens for this page: URL first, then what this device remembered. */
function initLens(slug: string, known: string[], offerUnassigned: boolean): Lens {
  trip = slug
  const params = new URLSearchParams(location.search)
  let lens: Lens | undefined
  if (params.has('who') || params.has('unassigned')) {
    lens = {
      people: (params.get('who') ?? '').split(',').filter(Boolean),
      mode: params.get('mode') === 'together' ? 'together' : 'any',
      unassigned: params.has('unassigned'),
    }
  } else {
    try {
      lens = JSON.parse(localStorage.getItem(storageKey()) ?? 'null') as Lens | undefined
    } catch {
      lens = undefined
    }
  }
  const unassigned = offerUnassigned && Boolean(lens?.unassigned)
  current = {
    people: unassigned ? [] : (lens?.people ?? []).filter((p) => known.includes(p)),
    mode: lens?.mode === 'together' ? 'together' : 'any',
    unassigned,
  }
  // A shared link sets the lens for this device too, so it follows navigation.
  remember()
  writeUrl()
  return current
}

export function setLens(next: Partial<Lens>) {
  current = { ...current, ...next }
  remember()
  writeUrl()
  document.dispatchEvent(new CustomEvent<Lens>(EVENT, { detail: current }))
}

export function onLens(listener: (lens: Lens) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Lens>).detail)
  document.addEventListener(EVENT, handler)
  return () => document.removeEventListener(EVENT, handler)
}

function remember() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(current))
  } catch {
    // Remembering is a convenience; the URL still carries the lens.
  }
}

function writeUrl() {
  const url = new URL(location.href)
  if (current.people.length) url.searchParams.set('who', current.people.join(','))
  else url.searchParams.delete('who')
  if (current.people.length > 1 && current.mode === 'together') url.searchParams.set('mode', 'together')
  else url.searchParams.delete('mode')
  if (current.unassigned) url.searchParams.set('unassigned', '')
  else url.searchParams.delete('unassigned')
  history.replaceState(history.state, '', url)
}

/** Whether something done by `members` is in view; `unassigned` plans only alone. */
export function inLens(members: string[], lens: Lens = current, unassigned = false): boolean {
  if (lens.unassigned || unassigned) return Boolean(lens.unassigned && unassigned)
  if (!lens.people.length) return true
  return lens.mode === 'together'
    ? lens.people.every((p) => members.includes(p))
    : lens.people.some((p) => members.includes(p))
}

/** The selected share of a cost split, by member: what the lens "owns". */
export function lensShare(shares: Record<string, number>, lens: Lens = current): number {
  const owners = lens.people.length ? lens.people : Object.keys(shares)
  return owners.reduce((sum, p) => sum + (shares[p] ?? 0), 0)
}

export function peopleOf(el: HTMLElement): string[] {
  return (el.dataset.people ?? '').split(' ').filter(Boolean)
}
