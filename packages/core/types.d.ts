// The web export produced by taac-core (`crates/taac-core/src/export.rs`).

export type ISODate = string
export type ISODateTime = string

export interface Diagnostic {
  severity: 'error' | 'warning'
  code: string
  message: string
  file?: string
  trip?: string
  item?: string
}

/** One string for every language, or one per language. */
export type Text = string | Record<string, string>

/** ECB reference rates against EUR, fetched when the site was built. */
export interface Rates {
  date: string
  /** Units of each currency per 1 EUR (EUR itself included). */
  rates: Record<string, number>
}

export interface SiteExport {
  apiVersion: 'taac/v1alpha4'
  site: { title: Text; description?: Text; passwordSecret?: string }
  trips: TripExport[]
  diagnostics: Diagnostic[]
}

export type ItemKind = 'flight' | 'train' | 'bus' | 'ferry' | 'transfer' | 'lodging' | 'activity' | 'meal' | 'note'
export type BookingStatus = 'required' | 'booked' | 'notRequired' | 'cancelled'

export interface Member {
  id: string
  name: string
  emoji?: string
  links?: string[]
  /** ISO 4217 code this person pays with. */
  currency?: string
}

export interface Group {
  id: string
  name: string
  emoji?: string
  description?: string
  members: string[]
}

export interface Place {
  name: string
  /** [lat, lon] */
  geo: [number, number]
  category?: string
  address?: string
  url?: string
  /** Metres; set on areas. */
  radius?: number
}

export type DayPart = 'morning' | 'afternoon' | 'evening'

export interface Base {
  id: string
  title: string
  place: string
  from: ISODate
  to: ISODate
  nights: number
  members: string[]
  /** Id into `TripExport.parties`. */
  party: string
  notes?: string
}

export interface Money {
  amount: number
  currency: string
}

export interface Cost {
  amount: number
  currency: string
  /** What was actually charged, once booked. */
  charged?: Money
  /** Member ids who paid; empty for `each` or when nobody has paid yet. */
  paidBy: string[]
  /** Member ids the cost is for. */
  who: string[]
  label?: string
  estimate: boolean
  /** Nobody has paid yet: an estimate or a price to pay later. */
  unpaid: boolean
  /** Paid by `each`: everyone paid their own share. */
  each: boolean
  /** Nobody owes anybody for it: unpaid, `each`, or paid back. */
  settled: boolean
}

export interface Booking {
  status: BookingStatus
  deadline?: ISODate
  provider?: string
  url?: string
  hasReference: boolean
}

export interface Idea {
  id: string
  title: string
  kind: ItemKind
  area?: string
  places: string[]
  members: string[]
  /** Id into `TripExport.parties`. */
  party: string
  priority: 'must' | 'maybe'
  duration?: 'hour' | 'halfDay' | 'day'
  booking?: Booking
  costs: Cost[]
  notes?: string
  url?: string
  tags: string[]
}

export interface Presence {
  id: string
  members: string[]
  party: string
}

/** People doing something together: `everyone`, a group id, or `a+b`. */
export interface Party {
  id: string
  members: string[]
  group?: string
}

export interface Item {
  id: string
  kind: ItemKind
  title: string
  start?: ISODateTime
  end?: ISODateTime
  local: {
    date: ISODate
    time?: string
    offset?: string
    part?: DayPart
    endDate?: ISODate
    endTime?: string
    endOffset?: string
  }
  places: string[]
  members: string[]
  /** Id into `TripExport.parties`. */
  party: string
  transport?: { carrier?: string; number?: string }
  booking: Booking
  costs: Cost[]
  contacts: { name: string; role?: string; hasPhone: boolean; hasEmail: boolean }[]
  notes?: string
  url?: string
  tags: string[]
  /** Blocker ids this plan may run through. */
  overrides: string[]
  conflicts: { blocker: string; members: string[]; overridden: boolean }[]
}

export interface Blocker {
  id: string
  title: string
  members: string[]
  party: string
  strict: boolean
  notes?: string
  time?: { start: string; end: string; timezone?: string }
}

export interface DayBlocker {
  id: string
  members: string[]
  party: string
  wholeDay: boolean
  /** `HH:MM` in the trip's zone; `24:00` when it runs to midnight. */
  start: string
  end: string
}

export interface Amounts {
  planned: number
  committed: number
}

export interface CostLine {
  /** Item, idea or packing item id. */
  item: string
  /** Packing purchases only: the packing item's name. */
  title?: string
  label?: string
  kind: string
  amount: number
  currency: string
  charged?: Money
  /** What balances use: `charged` if known, else the price. */
  settledAmount: number
  settledCurrency: string
  committed: boolean
  estimate: boolean
  /** Nobody has paid yet: `paid` is empty. */
  unpaid: boolean
  /** Nobody owes anybody for it: unpaid, `each`, or paid back. */
  settled: boolean
  /** Fraction each member bears (sums to 1). */
  shares: Record<string, number>
  /** Fraction each member paid (sums to 1). */
  paid: Record<string, number>
}

export interface Budget {
  /** The trip's default display currency. */
  base: string
  lines: CostLine[]
  ideas: CostLine[]
  byCurrency: Record<
    string,
    {
      total: Amounts
      members: { member: string; paid: Amounts; share: Amounts; balance: number }[]
      settlements: { from: string; to: string; amount: number }[]
    }
  >
}

export interface TripExport {
  slug: string
  title: string
  summary?: string
  locale?: string
  timezone: string
  cover?: { emoji?: string; hue?: number }
  tags: string[]
  passwordSecret?: string
  startDate?: ISODate
  endDate?: ISODate
  currency?: { base: string }
  members: Member[]
  groups: Group[]
  parties: Party[]
  places: Record<string, Place>
  bases: Base[]
  basesDerived: boolean
  items: Item[]
  ideas: Idea[]
  blockers: Blocker[]
  days: { date: ISODate; items: string[]; stays: Presence[]; bases: Presence[]; blockers: DayBlocker[] }[]
  budget: Budget
  packing: { category: string; items: { id: string; name: string; members: string[]; bought: boolean }[] }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
  artifacts: { ics: string; icsByMember: Record<string, string>; geojson: string; beancount: string; markdown: string }
  diagnostics: Diagnostic[]
}
