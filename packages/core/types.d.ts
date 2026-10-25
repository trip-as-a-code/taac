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

export interface SiteExport {
  apiVersion: 'taac/v1alpha3'
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

export interface Cost {
  amount: number
  currency: string
  baseAmount: number | null
  paidBy: string
  label?: string
  estimate: boolean
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
}

export interface Amounts {
  planned: number
  committed: number
}

export interface Budget {
  base: string
  total: Amounts
  /** Estimated cost of ideas, in the base currency. */
  possible: number
  byCurrency: Record<string, Amounts>
  byKind: Record<string, Amounts>
  members: { member: string; paid: Amounts; share: Amounts; balance: number }[]
  settlements: { from: string; to: string; amount: number }[]
  lines: {
    item: string
    label?: string
    amount: number
    currency: string
    baseAmount: number
    paidBy: string
    committed: boolean
    estimate: boolean
    shares: Record<string, number>
  }[]
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
  currency?: { base: string; rates: Record<string, number> }
  members: Member[]
  groups: Group[]
  parties: Party[]
  places: Record<string, Place>
  bases: Base[]
  basesDerived: boolean
  items: Item[]
  ideas: Idea[]
  days: { date: ISODate; items: string[]; stays: Presence[]; bases: Presence[] }[]
  budget: Budget
  packing: { category: string; items: { id: string; name: string; for: string[] }[] }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
  artifacts: { ics: string; icsByMember: Record<string, string>; geojson: string; beancount: string; markdown: string }
  diagnostics: Diagnostic[]
}
