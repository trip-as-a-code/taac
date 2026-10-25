// The budget in the viewer's display currency, for whoever the people lens
// selects. Lines carry fractions (who bears, who paid), so any selection and
// any currency can be computed here without the server.

import type { CostLine } from '@taac/core'

import { inLens, type Lens } from '@/scripts/lens'
import { value } from '@/scripts/money'

export interface BudgetData {
  base: string
  lines: CostLine[]
  ideas: CostLine[]
}

export interface Computed {
  planned: number
  committed: number
  possible: number
  /** Some amounts were converted at today's rate rather than charged. */
  estimated: boolean
  /** Same, among booked costs only. */
  committedEstimated: boolean
  /** Lines without a rate into the display currency, left out. */
  missing: number
  byKind: Map<string, number>
  /** What moved in each currency (charged, else quoted), for the selection. */
  byCurrency: Map<string, number>
  members: Map<string, { paid: number; share: number }>
  settlements: { from: string; to: string; amount: number }[]
  /** Per line, in display currency: the whole line and the selection's part. */
  lines: ({ total: number; mine: number; exact: boolean } | null)[]
}

const priced = (l: CostLine) => ({ amount: l.amount, currency: l.currency, charged: l.charged })

/** The fraction of a line the lens owns: everyone's when nobody is selected. */
export function owned(fractions: Record<string, number>, lens: Lens): number {
  if (!lens.people.length) return 1
  return lens.people.reduce((sum, p) => sum + (fractions[p] ?? 0), 0)
}

export function computeBudget(data: BudgetData, lens: Lens, members: string[]): Computed {
  const result: Computed = {
    planned: 0,
    committed: 0,
    possible: 0,
    estimated: false,
    committedEstimated: false,
    missing: 0,
    byKind: new Map(),
    byCurrency: new Map(),
    members: new Map(members.map((m) => [m, { paid: 0, share: 0 }])),
    settlements: [],
    lines: [],
  }
  for (const line of data.lines) {
    const shown = value(priced(line))
    if (!shown) {
      result.missing++
      result.lines.push(null)
      continue
    }
    for (const [m, f] of Object.entries(line.shares)) result.members.get(m)!.share += shown.amount * f
    for (const [m, f] of Object.entries(line.paid)) result.members.get(m)!.paid += shown.amount * f
    const visible = inLens(Object.keys(line.shares), lens)
    const mine = visible ? shown.amount * owned(line.shares, lens) : 0
    result.lines.push({ total: shown.amount, mine, exact: shown.exact })
    if (!visible) continue
    result.estimated ||= !shown.exact
    result.planned += mine
    if (line.committed) {
      result.committed += mine
      result.committedEstimated ||= !shown.exact
    }
    result.byKind.set(line.kind, (result.byKind.get(line.kind) ?? 0) + mine)
    const moved = line.settledAmount * owned(line.shares, lens)
    result.byCurrency.set(line.settledCurrency, (result.byCurrency.get(line.settledCurrency) ?? 0) + moved)
  }
  for (const idea of data.ideas) {
    const shown = value(priced(idea))
    if (shown && inLens(Object.keys(idea.shares), lens)) result.possible += shown.amount * owned(idea.shares, lens)
  }
  result.settlements = settle(result.members)
  return result
}

/** Greedy: the largest debtor pays the largest creditor until all are even. */
function settle(members: Map<string, { paid: number; share: number }>) {
  const cent = 0.005
  const creditors: [string, number][] = []
  const debtors: [string, number][] = []
  for (const [m, { paid, share }] of members) {
    const balance = paid - share
    if (balance > cent) creditors.push([m, balance])
    else if (balance < -cent) debtors.push([m, -balance])
  }
  const out: { from: string; to: string; amount: number }[] = []
  while (creditors.length && debtors.length) {
    creditors.sort((a, b) => b[1] - a[1])
    debtors.sort((a, b) => b[1] - a[1])
    const c = creditors[0]
    const d = debtors[0]
    const amount = Math.min(c[1], d[1])
    out.push({ from: d[0], to: c[0], amount })
    c[1] -= amount
    d[1] -= amount
    if (c[1] <= cent) creditors.shift()
    if (d[1] <= cent) debtors.shift()
  }
  return out
}
