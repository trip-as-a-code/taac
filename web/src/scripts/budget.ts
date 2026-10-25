// Budget figures for whoever the people lens selects: totals, currencies and
// categories are the selected people's shares; cards and transfers narrow to them.

import { inLens, lensShare, type Lens } from '@/scripts/lens'

interface BudgetData {
  base: string
  lines: {
    shares: Record<string, number>
    baseAmount: number
    amount: number
    currency: string
    committed: boolean
    kind: string
  }[]
  ideas: { members: string[]; amount: number }[]
}

const WHOLE = ['JPY', 'KRW', 'VND', 'ISK', 'HUF']

function money(amount: number, currency: string, whole = false): string {
  const fractional = !WHOLE.includes(currency) && !whole
  return new Intl.NumberFormat(document.documentElement.lang, {
    style: 'currency',
    currency,
    maximumFractionDigits: fractional ? 2 : 0,
    minimumFractionDigits: fractional && amount % 1 !== 0 ? 2 : 0,
  }).format(amount)
}

export function setupBudget(lens: Lens) {
  const raw = document.getElementById('budget-data')?.textContent
  if (!raw) return
  const data = JSON.parse(raw) as BudgetData
  const selected = lens.people
  const lines = data.lines.filter((l) => inLens(Object.keys(l.shares), lens))
  const share = (l: BudgetData['lines'][number]) => (selected.length ? lensShare(l.shares, lens) : l.baseAmount)

  const planned = lines.reduce((sum, l) => sum + share(l), 0)
  const committed = lines.filter((l) => l.committed).reduce((sum, l) => sum + share(l), 0)
  const possible = data.ideas
    .filter((i) => inLens(i.members, lens))
    .reduce((sum, i) => {
      const mine = selected.length ? i.members.filter((m) => selected.includes(m)).length / i.members.length : 1
      return sum + i.amount * mine
    }, 0)
  const set = (selector: string, text: string) => {
    const el = document.querySelector(selector)
    if (el) el.textContent = text
  }
  set('[data-total="planned"]', money(planned, data.base))
  set('[data-total="committed"]', money(committed, data.base))
  set('[data-total="possible"]', money(possible, data.base))

  for (const el of document.querySelectorAll<HTMLElement>('[data-currency]')) {
    const code = el.dataset.currency!
    const amount = lines
      .filter((l) => l.currency === code && l.baseAmount > 0)
      .reduce((sum, l) => sum + (l.amount * share(l)) / l.baseAmount, 0)
    el.hidden = amount < 0.005
    el.firstElementChild!.textContent = money(amount, code)
  }

  const byKind = new Map<string, number>()
  for (const l of lines) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + share(l))
  for (const bar of document.querySelectorAll<HTMLElement>('[data-kind-bar]')) {
    const amount = byKind.get(bar.dataset.kindBar!) ?? 0
    bar.style.flex = String(amount)
    bar.hidden = amount <= 0
  }
  const percent = new Intl.NumberFormat(document.documentElement.lang, { style: 'percent' })
  for (const row of document.querySelectorAll<HTMLElement>('[data-kind]')) {
    const amount = byKind.get(row.dataset.kind!) ?? 0
    row.hidden = amount <= 0
    row.querySelector('[data-kind-amount]')!.textContent = money(amount, data.base, true)
    row.querySelector('[data-kind-pct]')!.textContent = ` · ${percent.format(planned ? amount / planned : 0)}`
  }

  for (const card of document.querySelectorAll<HTMLElement>('[data-person]'))
    card.hidden = selected.length > 0 && !selected.includes(card.dataset.person!)
  for (const row of document.querySelectorAll<HTMLElement>('[data-settle]'))
    row.hidden = selected.length > 0 && !row.dataset.settle!.split(' ').some((p) => selected.includes(p))
}
