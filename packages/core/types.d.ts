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

export interface SiteExport {
  apiVersion: 'taac/v1alpha1'
  site: { title: string; description?: string; passwordSecret?: string }
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
}

export interface Item {
  id: string
  kind: ItemKind
  title: string
  start: ISODateTime
  end?: ISODateTime
  local: {
    date: ISODate
    time: string
    offset: string
    endDate?: ISODate
    endTime?: string
    endOffset?: string
  }
  places: string[]
  members: string[]
  group?: string
  transport?: { carrier?: string; number?: string }
  booking: { status: BookingStatus; deadline?: ISODate; provider?: string; url?: string; hasReference: boolean }
  costs: { amount: number; currency: string; baseAmount: number | null; paidBy: string; label?: string }[]
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
  places: Record<string, Place>
  items: Item[]
  days: { date: ISODate; items: string[]; stays: string[] }[]
  budget: Budget
  packing: { category: string; items: { id: string; name: string; for: string[] }[] }[]
  overlays: { name: string; data: { type: string; features?: unknown[] } }[]
  artifacts: { ics: string; geojson: string; beancount: string; markdown: string }
  diagnostics: Diagnostic[]
}
