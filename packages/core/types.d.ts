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
  /** The specifics, for phrasing the message in the interface's language. */
  params?: Record<string, string>
  /** YAML that fixes it, ready to paste into the entry. */
  fix?: string
}

/** File (relative to the site file's directory) and 1-based line of an entry. */
export interface Source {
  file: string
  line: number
}

/** Web repository holding the trip files. */
export interface SourceRepo {
  repo: string
  branch: string
  dir: string
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
  site: { title: Text; description?: Text; passwordSecret?: string; source?: SourceRepo }
  trips: TripExport[]
  diagnostics: Diagnostic[]
}

export type ItemKind =
  'flight' | 'train' | 'bus' | 'ferry' | 'transfer' | 'walk' | 'ride' | 'lodging' | 'activity' | 'meal' | 'note'
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
  /** Unnamed groups are shown by their members' names. */
  name?: string
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
  /** Charged later, on this date: until then the converted amount is an estimate. */
  due?: ISODate
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
  source?: Source
  kind: ItemKind
  area?: string
  places: string[]
  members: string[]
  /** Id into `TripExport.parties`. */
  party: string
  priority: 'must' | 'maybe'
  duration?: 'hour' | 'halfDay' | 'day'
  /** When it is proposed for; absent without a date. */
  local?: Item['local']
  /** Alternatives for one need share this label. */
  option?: string
  transport?: Transport
  /** How to book it if chosen; never `booked`. */
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
  source?: Source
  /** Booked under the same reference as this plan, which carries the price. */
  pricedWith?: string
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
  transport?: Transport
  /** Overall booking state; a summary when there are several reservations. */
  booking: Booking
  /** Reservations when there are several, each with its people. */
  bookings?: (Booking & { members: string[]; costs: Cost[] })[]
  /** Every cost, its reservations' included. */
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

/** How a journey goes; a rental service is the `carrier`. */
export interface Transport {
  carrier?: string
  number?: string
  vehicle?: 'bicycle' | 'scooter'
}

/** A ticket, pass or rental covering an area on its days. */
export interface Pass {
  id: string
  title: string
  members: string[]
  party: string
  mode: 'transit' | 'bicycle' | 'scooter'
  /** Place id of the area. */
  area: string
  from: ISODate
  to: ISODate
  provider?: string
  url?: string
  status: BookingStatus
  deadline?: ISODate
  notes?: string
}

/** Something to get done before the trip; `required` means the trip depends on it. */
export interface Task {
  id: string
  title: string
  members: string[]
  party: string
  required: boolean
  due?: ISODate
  done?: ISODate
  notes?: string
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
  /** An idea's option group: only the cheapest alternative counts. */
  option?: string
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
  /** Pays the payer back for everyone's share. */
  owedBy?: string
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
  tasks: Task[]
  passes: Pass[]
  days: { date: ISODate; items: string[]; stays: Presence[]; bases: Presence[]; blockers: DayBlocker[] }[]
  budget: Budget
  packing: {
    category: string
    items: {
      id: string
      name: string
      members: string[]
      bought: boolean
      qty?: number
      bag?: string
      notes?: string
    }[]
  }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
  artifacts: {
    ics: string
    geojson: string
    beancount: string
    markdown: string
    /** The same files per member and per group (by id), with only what they take part in. */
    byParty: Record<string, { ics: string; geojson: string; beancount: string; markdown: string }>
  }
  diagnostics: Diagnostic[]
}
