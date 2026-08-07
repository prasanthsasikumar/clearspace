import { describe, expect, it } from 'vitest'
import {
  buildMarketplaceSheet,
  CONDITIONS,
  MAX_LISTINGS,
  type MarketplaceItem,
} from '@/domain/export/marketplace'

const base: MarketplaceItem = {
  id: 'item-1',
  title: 'Lounge chair, walnut and leather',
  priceCents: 14000,
  condition: 'good',
  description: 'Some wear on both arms.',
}

/** Data rows only: the template's own four preamble rows sit above them. */
const data = (rows: readonly unknown[][]) => rows.slice(4)

describe('buildMarketplaceSheet', () => {
  it('reproduces the template’s header row exactly', () => {
    const { rows } = buildMarketplaceSheet([])
    expect(rows[3]).toEqual(['TITLE', 'PRICE', 'CONDITION', 'DESCRIPTION', 'CATEGORY'])
    expect(rows[1]![0]).toContain('up to 50 listings at once')
  })

  it('writes price as a whole number of dollars, not cents', () => {
    const [row] = data(buildMarketplaceSheet([{ ...base, priceCents: 14000 }]).rows)
    expect(row![1]).toBe(140)
    expect(typeof row![1]).toBe('number')
  })

  it('rounds part-dollar prices rather than truncating them', () => {
    expect(data(buildMarketplaceSheet([{ ...base, priceCents: 14050 }]).rows)[0]![1]).toBe(141)
    expect(data(buildMarketplaceSheet([{ ...base, priceCents: 14049 }]).rows)[0]![1]).toBe(140)
  })

  /*
   * The values come from the template's VALIDATION sheet, which uses an EN
   * DASH. Its help text uses a hyphen instead, and the two disagree; if
   * Facebook ever rejects an upload over this, that constant is the one place
   * to change.
   */
  it('uses the exact condition strings the template validates against', () => {
    expect(CONDITIONS.like_new).toBe('Used – like new')
    expect(CONDITIONS.good).toBe('Used – good')
    expect(CONDITIONS.fair).toBe('Used – fair')
    expect(CONDITIONS.new).toBe('New')
  })

  it('collapses seven conditions onto the four Marketplace allows', () => {
    const conditionOf = (condition: MarketplaceItem['condition']) =>
      data(buildMarketplaceSheet([{ ...base, condition }]).rows)[0]![2]

    expect(conditionOf('new')).toBe(CONDITIONS.new)
    expect(conditionOf('like_new')).toBe(CONDITIONS.like_new)
    expect(conditionOf('excellent')).toBe(CONDITIONS.good)
    expect(conditionOf('good')).toBe(CONDITIONS.good)
    expect(conditionOf('fair')).toBe(CONDITIONS.fair)
    expect(conditionOf('poor')).toBe(CONDITIONS.fair)
    expect(conditionOf('for_parts')).toBe(CONDITIONS.fair)
  })

  it('warns when for-parts is flattened to fair, which invites a dispute', () => {
    const result = buildMarketplaceSheet([{ ...base, condition: 'for_parts' }])
    expect(result.rowCount).toBe(1)
    expect(result.warnings.some((w) => w.field === 'condition')).toBe(true)
  })

  it('leaves out anything missing a field Marketplace requires', () => {
    const result = buildMarketplaceSheet([
      { ...base, id: 'a', priceCents: null },
      { ...base, id: 'b', condition: null },
      { ...base, id: 'c', title: '   ' },
      { ...base, id: 'd' },
    ])
    expect(result.rowCount).toBe(1)
    expect(result.skipped.map((s) => s.field).sort()).toEqual(['condition', 'price', 'title'])
  })

  it('drops a price that rounds away to nothing rather than listing it free', () => {
    const result = buildMarketplaceSheet([{ ...base, priceCents: 40 }])
    expect(result.rowCount).toBe(0)
    expect(result.skipped[0]!.field).toBe('price')
  })

  it('stops at the template’s fifty-listing limit and says what it dropped', () => {
    const many = Array.from({ length: 55 }, (_, i) => ({ ...base, id: `item-${i}` }))
    const result = buildMarketplaceSheet(many)
    expect(result.rowCount).toBe(MAX_LISTINGS)
    expect(result.skipped).toHaveLength(5)
    expect(result.skipped.every((s) => s.field === 'limit')).toBe(true)
  })

  it('truncates rather than rejects an over-long title, and says so', () => {
    const long = 'x'.repeat(200)
    const result = buildMarketplaceSheet([{ ...base, title: long }])
    expect(String(data(result.rows)[0]![0]).length).toBe(150)
    expect(result.warnings.some((w) => w.field === 'title')).toBe(true)
  })

  /*
   * Every valid CATEGORY is a full path like `Furniture//Bedroom
   * Furniture//Dressers`, and this app's categories are fifteen coarse
   * buckets. The column is optional, so a blank is honest where a guess would
   * file a chair under wardrobes.
   */
  it('leaves category blank rather than guessing a taxonomy leaf', () => {
    expect(data(buildMarketplaceSheet([base]).rows)[0]![4]).toBeNull()
  })
})
