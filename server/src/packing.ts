// Packing ticks shared by everyone on a trip. Each tick is one person and one
// item, packed or not, stamped with when it was set; the latest stamp wins, so
// devices that were offline merge without losing anyone's ticks or unticks.

export interface Tick {
  packed: boolean
  /** Epoch milliseconds when it was set, on the device that set it. */
  at: number
}

/** `item|member` → tick. */
export type Ticks = Record<string, Tick>

export interface Change extends Tick {
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

/** Applies valid changes newer than what is stored; returns how many applied. */
export function merge(ticks: Ticks, changes: unknown, now: number): number {
  let applied = 0
  for (const c of validChanges(changes, now)) {
    const key = `${c.item}|${c.member}`
    if (!(key in ticks) && Object.keys(ticks).length >= MAX_TICKS) continue
    if ((ticks[key]?.at ?? -1) >= c.at) continue
    ticks[key] = { packed: c.packed, at: c.at }
    applied++
  }
  return applied
}

/** `/trips/<slug>/_packing` → the slug. */
export function packingSlug(path: string): string | null {
  const match = /^\/trips\/([^/]+)\/_packing$/.exec(path)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
