// Packing ticks, shared by everyone on the trip through the server
// (`/trips/<slug>/_packing`). Each tick is one person and one item with the
// time it was set and the GitHub login that set it; the latest wins. This device keeps a copy and a queue, so
// ticks made offline go up when it is back.

export interface Tick {
  packed: boolean
  at: number
  /** Who set it: their GitHub login, stamped by the server. */
  by?: string
  /** On an untick: who had made the tick it took back. */
  undid?: string
}

/** `item|member` → tick. */
export type Ticks = Record<string, Tick>

interface Change extends Omit<Tick, 'by' | 'undid'> {
  item: string
  member: string
}

/** Takes what is newer from `from`; whether anything changed. */
export function mergeTicks(into: Ticks, from: Ticks): boolean {
  let changed = false
  for (const [key, tick] of Object.entries(from)) {
    if ((into[key]?.at ?? -1) < tick.at) {
      into[key] = tick
      changed = true
    }
  }
  return changed
}

export class PackingStore {
  ticks: Ticks = {}
  private pending: Change[] = []
  /** False when the deployment has nowhere to keep ticks (no database). */
  available = true
  /** False for someone who may only look: a viewer, or signed out on a public trip. */
  writable = true
  private syncing: Promise<void> | undefined

  constructor(
    private readonly slug: string,
    private readonly onChange: () => void,
  ) {
    this.load()
  }

  private get key() {
    return `taac:packing:${this.slug}`
  }

  private load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as { ticks: Ticks; pending: Change[] } | null
      if (saved) ({ ticks: this.ticks, pending: this.pending } = saved)
    } catch {
      // Only a copy: the server has them.
    }
  }

  private save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ ticks: this.ticks, pending: this.pending }))
    } catch {
      // Same: the server has them.
    }
  }

  /** Who this device ticks as, until the server confirms it. */
  login: string | null = null

  private record(item: string, member: string, packed: boolean, at: number) {
    const was = this.ticks[`${item}|${member}`]
    // An untick remembers whose tick it took back, as the server does.
    const undid = !packed && was?.packed ? was.by : undefined
    this.ticks[`${item}|${member}`] = {
      packed,
      at,
      ...(this.login ? { by: this.login } : {}),
      ...(undid ? { undid } : {}),
    }
    this.pending = [...this.pending.filter((c) => c.item !== item || c.member !== member), { item, member, packed, at }]
  }

  packed(item: string, member: string): boolean {
    return Boolean(this.ticks[`${item}|${member}`]?.packed)
  }

  /** The last tick or untick and who made it, when that is known. */
  lastBy(item: string, member: string): { packed: boolean; by: string } | undefined {
    const tick = this.ticks[`${item}|${member}`]
    return tick?.by ? { packed: tick.packed, by: tick.by } : undefined
  }

  set(item: string, member: string, packed: boolean) {
    if (!this.available || !this.writable) return
    this.record(item, member, packed, Date.now())
    this.save()
    this.onChange()
    void this.sync()
  }

  /** Sends what this device changed and takes everyone else's ticks. */
  sync(): Promise<void> {
    if (!this.available) return Promise.resolve()
    this.syncing ??= this.exchange().finally(() => (this.syncing = undefined))
    return this.syncing
  }

  private async exchange() {
    const sent = this.pending
    try {
      const response = await fetch(`/trips/${encodeURIComponent(this.slug)}/_packing`, {
        method: sent.length ? 'POST' : 'GET',
        headers: sent.length ? { 'Content-Type': 'application/json' } : undefined,
        body: sent.length ? JSON.stringify({ changes: sent }) : undefined,
        credentials: 'same-origin',
      })
      if (response.status === 404) {
        this.available = false
        this.onChange()
        return
      }
      if (response.status === 403) {
        // Not theirs to tick: drop what was queued and take the list as it is.
        this.writable = false
        this.pending = []
        this.ticks = {}
        this.save()
        this.onChange()
        void this.sync()
        return
      }
      if (!response.ok) return
      const { ticks } = (await response.json()) as { ticks: Ticks }
      this.pending = this.pending.filter((c) => !sent.includes(c))
      mergeTicks(this.ticks, ticks)
      this.save()
      this.onChange()
    } catch {
      // Offline: the changes wait in `pending` for the next sync.
    }
  }
}
