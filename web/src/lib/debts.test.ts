import { describe, expect, it } from 'vitest'

import { asOf, lineDebts, pairDebts } from './debts'

const third = 1 / 3

describe('debts', () => {
  it('splits what one person paid among the others', () => {
    const debts = lineDebts({ a: third, b: third, c: third }, { a: 1 }, 90)
    expect(debts.map((d) => [d.from, d.to, Math.round(d.amount)])).toEqual([
      ['b', 'a', 30],
      ['c', 'a', 30],
    ])
  })

  it('lets one person owe for everyone', () => {
    const debts = lineDebts({ b: 0.5, c: 0.5 }, { a: 1 }, 100, 'b')
    expect(debts.map((d) => [d.from, d.to, Math.round(d.amount)])).toEqual([['b', 'a', 100]])
  })

  it('owes nothing when everyone paid their part', () => {
    expect(lineDebts({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 }, 100)).toEqual([])
  })

  it('nets each pair and keeps the expenses behind it', () => {
    const pairs = pairDebts([
      { index: 0, debts: lineDebts({ a: 0.5, b: 0.5 }, { a: 1 }, 100) },
      { index: 1, debts: lineDebts({ a: 0.5, b: 0.5 }, { b: 1 }, 40) },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ from: 'b', to: 'a', amount: 30 })
    expect(pairs[0].lines).toEqual([
      { index: 0, amount: 50 },
      { index: 1, amount: -20 },
    ])
  })
})

describe('asOf', () => {
  const line = { shares: { a: 0.5, b: 0.5 }, paid: { a: 1 }, unpaid: false, settled: false, due: '2026-12-05' }

  it('owes nothing before a cost is charged', () => {
    const before = asOf(line, '2026-11-01')
    expect(before.unpaid).toBe(true)
    expect(lineDebts(before.shares, before.paid, 100)).toEqual([])
  })

  it('owes from the day it is charged', () => {
    const after = asOf(line, '2026-12-05')
    expect(lineDebts(after.shares, after.paid, 100)).toEqual([{ from: 'b', to: 'a', amount: 50 }])
  })
})
