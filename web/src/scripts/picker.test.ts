import { describe, expect, it } from 'vitest'

import { fold, fuzzy } from './picker'

describe('fuzzy', () => {
  it('folds case and diacritics', () => {
    expect(fold('Kyōto')).toBe('kyoto')
    expect(fuzzy('kyoto', 'Kyōto')?.hits).toEqual([0, 1, 2, 3, 4])
  })

  it('matches characters in order, not only substrings', () => {
    expect(fuzzy('jpy', 'JPY · Japanese yen')).toBeDefined()
    expect(fuzzy('jy', 'JPY · Japanese yen')).toBeDefined()
    expect(fuzzy('yj', 'JPY')).toBeUndefined()
  })

  it('ranks word starts and runs above scattered hits', () => {
    const word = fuzzy('yen', 'JPY · Japanese yen')!.score
    const scattered = fuzzy('yen', 'Mayotte · Venezuela')!.score
    expect(word).toBeGreaterThan(scattered)
  })

  it('lines hits up with characters past emoji', () => {
    expect(fuzzy('to', '🗼 Tokyo')?.hits).toEqual([2, 3])
  })
})
