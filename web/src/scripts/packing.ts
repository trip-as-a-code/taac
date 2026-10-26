// Packing ticks, shared through the worker when it has somewhere to keep
// them (`/trips/<slug>/_packing`), on this device otherwise. Each tick is one
// person and one item with the time it was set; the latest wins, so ticks made
// offline merge in when the device is back.

export interface Tick {
  packed: boolean
  at: number
}

/** `item|member` → tick. */
export type Ticks = Record<string, Tick>

interface Change extends Tick {
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
  /** Undefined until the first answer; false when ticks stay on this device. */
  shared: boolean | undefined
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
      // Before ticks were shared, each person had a list on each device.
      for (const legacy of Object.keys(localStorage).filter((k) => k.startsWith(`${this.key}:`))) {
        const member = legacy.slice(this.key.length + 1)
        const old = JSON.parse(localStorage.getItem(legacy) ?? '{}') as Record<string, boolean>
        for (const [item, packed] of Object.entries(old)) if (packed) this.record(item, member, true, 1)
        localStorage.removeItem(legacy)
      }
    } catch {
      // Ticks are a convenience: start over rather than fail.
    }
  }

  private save() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ ticks: this.ticks, pending: this.pending }))
    } catch {
      // Same: the server, when there is one, still has them.
    }
  }

  private record(item: string, member: string, packed: boolean, at: number) {
    this.ticks[`${item}|${member}`] = { packed, at }
    this.pending = [...this.pending.filter((c) => c.item !== item || c.member !== member), { item, member, packed, at }]
  }

  packed(item: string, member: string): boolean {
    return Boolean(this.ticks[`${item}|${member}`]?.packed)
  }

  set(item: string, member: string, packed: boolean) {
    this.record(item, member, packed, Date.now())
    this.save()
    this.onChange()
    void this.sync()
  }

  /** Sends what this device changed and takes everyone else's ticks. */
  sync(): Promise<void> {
    if (this.shared === false) return Promise.resolve()
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
        this.shared = false
        this.onChange()
        return
      }
      if (!response.ok) return
      const { ticks } = (await response.json()) as { ticks: Ticks }
      this.shared = true
      this.pending = this.pending.filter((c) => !sent.includes(c))
      mergeTicks(this.ticks, ticks)
      this.save()
      this.onChange()
    } catch {
      // Offline: the changes wait in `pending` for the next sync.
    }
  }
}
