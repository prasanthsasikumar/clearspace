import { describe, expect, it } from 'vitest'
import { assignLotNumbers } from '@/domain/export/lot-numbers'

describe('assignLotNumbers', () => {
  it('numbers an unnumbered lot from one, in the order given', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: null },
      { id: 'b', lotNumber: null },
      { id: 'c', lotNumber: null },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('b')).toBe(2)
    expect(result.get('c')).toBe(3)
  })

  it('keeps numbers that were already assigned', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 1 },
      { id: 'b', lotNumber: 2 },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('b')).toBe(2)
  })

  it('continues from the highest existing number, so a published catalogue never shifts', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 1 },
      { id: 'new', lotNumber: null },
      { id: 'c', lotNumber: 40 },
      { id: 'alsoNew', lotNumber: null },
    ])

    expect(result.get('a')).toBe(1)
    expect(result.get('c')).toBe(40)
    expect(result.get('new')).toBe(41)
    expect(result.get('alsoNew')).toBe(42)
  })

  it('returns an entry for every item so callers never read undefined', () => {
    const result = assignLotNumbers([
      { id: 'a', lotNumber: 7 },
      { id: 'b', lotNumber: null },
    ])
    expect(result.size).toBe(2)
  })

  it('handles an empty lot', () => {
    expect(assignLotNumbers([]).size).toBe(0)
  })
})
