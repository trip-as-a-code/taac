// Packing ticks shared by everyone on a trip. Each tick is one person and one
// item, packed or not, stamped with when it was set; the latest stamp wins, so
// devices that were offline merge without losing anyone's ticks or unticks.

export interface Tick {
  packed: boolean
  /** Epoch milliseconds when it was set, on the device that set it. */
  at: number
  /** The GitHub login that set it, from the session; absent on a public site or for older ticks. */
  by?: string
  /** On an untick: who had made the tick it took back. */
  undid?: string
}

/** `item|member` → tick. */
export type Ticks = Record<string, Tick>

export interface Change extends Omit<Tick, 'by' | 'undid'> {
  item: string
  member: string
}

const ID = /^[\p{L}\p{N}_-]{1,80}$/u
export const MAX_TICKS = 5000
const SKEW = 24 * 60 * 60 * 1000

/** Well-formed changes, not from the far future, at most 500 of them. */
export function validChanges(changes: unknown, now: number): Change[] {
  if (!Array.isArray(changes)) return []
  const valid: Change[] = []
  for (const c of changes.slice(0, 500) as Partial<Change>[]) {
    if (typeof c?.item !== 'string' || typeof c.member !== 'string') continue
    if (!ID.test(c.item) || !ID.test(c.member) || typeof c.packed !== 'boolean') continue
    if (typeof c.at !== 'number' || !Number.isFinite(c.at) || c.at > now + SKEW) continue
    valid.push({ item: c.item, member: c.member, packed: c.packed, at: c.at })
  }
  return valid
}

/** Applies valid changes newer than what is stored, as set by `by`; returns how many applied. */
export function merge(ticks: Ticks, changes: unknown, now: number, by: string | null = null): number {
  let applied = 0
  for (const c of validChanges(changes, now)) {
    const key = `${c.item}|${c.member}`
    if (!(key in ticks) && Object.keys(ticks).length >= MAX_TICKS) continue
    const was = ticks[key]
    if ((was?.at ?? -1) >= c.at) continue
    const undid = !c.packed && was?.packed ? was.by : undefined
    ticks[key] = { packed: c.packed, at: c.at, ...(by ? { by } : {}), ...(undid ? { undid } : {}) }
    applied++
  }
  return applied
}

/**
 * The ticks' item for an anchor: a packing item by its id, a task as
 * `task-<id>` (one tick for everyone as member `_`, or one per member).
 */
export function tickItem(anchor: string): string | null {
  if (anchor.startsWith('packing:')) return anchor.slice(8)
  if (anchor.startsWith('task:')) return `task-${anchor.slice(5)}`
  return null
}

/** `/trips/<slug>/_packing` → the slug. */
export function packingSlug(path: string): string | null {
  const match = /^\/trips\/([^/]+)\/_packing$/.exec(path)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
