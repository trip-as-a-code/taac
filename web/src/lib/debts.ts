// Who owes whom, expense by expense. Each cost line says what fraction each
// member bears and paid; whoever paid less than their part owes the ones who
// paid more, in proportion. Summed per pair and netted, that is a settlement
// you can trace back to the expenses behind it.

export interface Debt {
  from: string
  to: string
  amount: number
}

const CENT = 0.005

/**
 * A line as of `today`: one charged later (`due`) is planned but not yet paid
 * before its date, so it creates no debts and nobody has paid it.
 */
export function asOf<T extends { due?: string; paid: Record<string, number>; unpaid: boolean; settled: boolean }>(
  line: T,
  today: string,
): T {
  return line.due && today < line.due ? { ...line, paid: {}, unpaid: true, settled: true } : line
}

/**
 * Debts one expense of `amount` creates. Settled lines (paid = shares) create
 * none. With `owedBy`, everyone else's debt is that member's.
 */
export function lineDebts(
  shares: Record<string, number>,
  paid: Record<string, number>,
  amount: number,
  owedBy?: string,
): Debt[] {
  const members = [...new Set([...Object.keys(shares), ...Object.keys(paid), ...(owedBy ? [owedBy] : [])])]
  let net = members.map((m) => [m, ((paid[m] ?? 0) - (shares[m] ?? 0)) * amount] as const)
  if (owedBy) {
    const owed = net.filter(([m, v]) => m !== owedBy && v < 0).reduce((sum, [, v]) => sum + v, 0)
    net = net.map(([m, v]) => [m, m === owedBy ? v + owed : v < 0 ? 0 : v] as const)
  }
  const owed = net.filter(([, v]) => v > CENT)
  const owing = net.filter(([, v]) => v < -CENT)
  const total = owed.reduce((sum, [, v]) => sum + v, 0)
  return owing.flatMap(([from, v]) => owed.map(([to, w]) => ({ from, to, amount: (-v * w) / total })))
}

export interface PairDebt extends Debt {
  /** What each expense adds to this debt; negative ones offset it. */
  lines: { index: number; amount: number }[]
}

/** Every expense's debts, summed and netted per pair of people. */
export function pairDebts(lines: { index: number; debts: Debt[] }[]): PairDebt[] {
  const pairs = new Map<string, { a: string; b: string; net: number; lines: Map<number, number> }>()
  for (const { index, debts } of lines) {
    for (const d of debts) {
      const [a, b] = d.from < d.to ? [d.from, d.to] : [d.to, d.from]
      const sign = d.from === a ? 1 : -1
      const key = `${a}\u0000${b}`
      const pair = pairs.get(key) ?? { a, b, net: 0, lines: new Map() }
      pair.net += sign * d.amount
      pair.lines.set(index, (pair.lines.get(index) ?? 0) + sign * d.amount)
      pairs.set(key, pair)
    }
  }
  return [...pairs.values()]
    .filter((p) => Math.abs(p.net) > CENT)
    .map((p) => {
      const forward = p.net > 0
      return {
        from: forward ? p.a : p.b,
        to: forward ? p.b : p.a,
        amount: Math.abs(p.net),
        lines: [...p.lines]
          .map(([index, amount]) => ({ index, amount: forward ? amount : -amount }))
          .filter((l) => Math.abs(l.amount) > CENT)
          .sort((x, y) => y.amount - x.amount),
      }
    })
    .sort((x, y) => y.amount - x.amount)
}
