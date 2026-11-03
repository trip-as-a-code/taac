import { describe, expect, it } from 'vitest'

import type { ChangeSet } from './changes'
import { movedAnchors } from './threads'

const renamed = (date: string, fromId: string, id: string): ChangeSet => ({
  sha: date,
  date,
  author: 'a',
  events: [],
  moves: [[`item:${fromId}`, `item:${id}`]],
})

const target = { title: 't', href: '/' }

describe('movedAnchors', () => {
  it('leads every old anchor of a renamed plan to its current one', () => {
    // Newest first, as the build lists them: прогулка → walk → evening-walk.
    const sets = [renamed('2026-11-02', 'walk', 'evening-walk'), renamed('2026-11-01', 'прогулка', 'walk')]
    expect(movedAnchors(sets, { 'item:evening-walk': target })).toEqual({
      'item:прогулка': 'item:evening-walk',
      'item:walk': 'item:evening-walk',
    })
  })

  it('leaves an old anchor that something else took, and a plan that is gone', () => {
    const sets = [renamed('2026-11-01', 'a', 'b'), renamed('2026-11-02', 'c', 'd')]
    // `a` is a plan again; `d` no longer exists.
    expect(movedAnchors(sets, { 'item:a': target, 'item:b': target })).toEqual({})
  })
})
