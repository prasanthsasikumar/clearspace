import { describe, expect, it } from 'vitest'
import { assignSheetRows, usablePriceCents } from '@/domain/sheet-results'

const order = ['a', 'b', 'c']

/**
 * One reply covers a whole lot, and a tile number is the only thing tying any
 * of it to an item. A miscount would write a lamp's price onto a drill, so
 * none of it is trusted.
 */
describe('assignSheetRows', () => {
  it('maps tile numbers onto ids, one-based', () => {
    const { assigned, unmatched } = assignSheetRows(order, [
      { n: 1, priceCents: 100 },
      { n: 3, priceCents: 300 },
    ])
    expect(assigned.map((a) => a.itemId)).toEqual(['a', 'c'])
    expect(unmatched).toEqual(['b'])
  })

  it('drops a tile number past the end of the sheet', () => {
    const { assigned, unmatched } = assignSheetRows(order, [{ n: 9, priceCents: 100 }])
    expect(assigned).toHaveLength(0)
    expect(unmatched).toEqual(['a', 'b', 'c'])
  })

  it('drops a zero or negative tile number', () => {
    expect(assignSheetRows(order, [{ n: 0 }, { n: -2 }]).assigned).toHaveLength(0)
  })

  it('keeps the first answer when a tile is answered twice', () => {
    const { assigned } = assignSheetRows(order, [
      { n: 2, priceCents: 100 },
      { n: 2, priceCents: 999 },
    ])
    expect(assigned).toHaveLength(1)
    expect(assigned[0]!.row.priceCents).toBe(100)
  })

  it('reports everything unmatched when the reply is empty', () => {
    expect(assignSheetRows(order, []).unmatched).toEqual(['a', 'b', 'c'])
  })
})

describe('usablePriceCents', () => {
  /*
   * Zero is the one that matters. An item priced at nothing is dropped from
   * every export, so accepting it would quietly delete something from the
   * inventory rather than leave it visibly unpriced.
   */
  it('refuses zero, negatives, and nonsense', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, '40', undefined]) {
      expect(usablePriceCents(value)).toBeNull()
    }
  })

  it('rounds to whole cents', () => {
    expect(usablePriceCents(4000)).toBe(4000)
    expect(usablePriceCents(4000.4)).toBe(4000)
  })
})
