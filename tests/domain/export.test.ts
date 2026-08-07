import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@/domain/export/csv'
import {
  FACEBOOK_COLUMNS,
  buildFacebookFeed,
  formatPrice,
  type ExportableItem,
} from '@/domain/export/facebook'

const base: ExportableItem = {
  id: 'item-1',
  title: 'Mesh office chair',
  description: 'Used, works fine.',
  condition: 'good',
  priceCents: 4500,
  currency: 'USD',
  brand: 'Herman Miller',
  category: 'furniture',
  imageUrls: ['https://example.test/a.jpg'],
  itemUrl: 'https://example.test/items/item-1',
}

describe('csv', () => {
  it('escapes the characters listing copy is full of', () => {
    expect(csvCell('He said "no", then left')).toBe('"He said ""no"", then left"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  it('renders null and undefined as empty rather than the word null', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('writes a BOM and CRLF so Excel does not mangle it', () => {
    const csv = toCsv(['a'], [['x']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('\r\n')
  })
})

describe('formatPrice', () => {
  it('uses the amount-space-currency form Facebook requires', () => {
    expect(formatPrice(4500, 'USD')).toBe('45.00 USD')
    expect(formatPrice(999, 'NZD')).toBe('9.99 NZD')
    expect(formatPrice(0, 'USD')).toBe('0.00 USD')
  })
})

describe('buildFacebookFeed', () => {
  it('emits the documented required columns', () => {
    const { csv } = buildFacebookFeed([base])
    for (const column of ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link']) {
      expect(FACEBOOK_COLUMNS).toContain(column)
      expect(csv).toContain(column)
    }
  })

  it('maps our condition vocabulary onto Facebook’s', () => {
    expect(buildFacebookFeed([{ ...base, condition: 'like_new' }]).csv).toContain('used_like_new')
    expect(buildFacebookFeed([{ ...base, condition: 'fair' }]).csv).toContain('used_fair')
    expect(buildFacebookFeed([{ ...base, condition: 'for_parts' }]).csv).toContain('used_fair')
    expect(buildFacebookFeed([{ ...base, condition: 'new' }]).csv).toContain('"new"')
  })

  it('leaves an unpriced item out rather than exporting it at zero', () => {
    const result = buildFacebookFeed([base, { ...base, id: 'item-2', priceCents: null }])
    expect(result.rowCount).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.field).toBe('price')
  })

  /*
   * A whole lot straight off the board has no prices on it yet, so every row
   * is skipped and the file comes out as a bare header. That is correct, and
   * it is exactly why the export control has to check `rowCount` before it
   * offers a download: the seller who clicks anyway gets an empty file and no
   * idea why.
   */
  it('exports nothing at all when nothing has been priced', () => {
    const result = buildFacebookFeed([
      { ...base, id: 'item-1', priceCents: null },
      { ...base, id: 'item-2', priceCents: null },
      { ...base, id: 'item-3', priceCents: 0 },
    ])
    expect(result.rowCount).toBe(0)
    expect(result.skipped).toHaveLength(3)
    expect(result.skipped.every((s) => s.field === 'price')).toBe(true)
  })

  it('leaves out an item with no photograph: the feed would reject it anyway', () => {
    const result = buildFacebookFeed([{ ...base, imageUrls: [] }])
    expect(result.rowCount).toBe(0)
    expect(result.skipped[0]!.field).toBe('image_link')
  })

  it('warns about a missing brand instead of inventing one', () => {
    const result = buildFacebookFeed([{ ...base, brand: null }])
    expect(result.rowCount).toBe(1)
    expect(result.warnings.some((w) => w.field === 'brand')).toBe(true)
    expect(result.csv).not.toMatch(/Herman/)
  })

  it('puts extra views in additional_image_link, capped at twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => `https://example.test/${i}.jpg`)
    const { csv } = buildFacebookFeed([{ ...base, imageUrls: many }])
    expect(csv).toContain('https://example.test/0.jpg')
    expect(csv).toContain('https://example.test/20.jpg')
    expect(csv).not.toContain('https://example.test/21.jpg')
  })

  it('survives a description full of quotes and newlines', () => {
    const nasty = 'He said "take it".\n\nCollection only, cash.'
    const { csv, rowCount } = buildFacebookFeed([{ ...base, description: nasty }])
    expect(rowCount).toBe(1)
    expect(csv).toContain('""take it""')
  })

  it('produces a header-only file for an empty lot', () => {
    const result = buildFacebookFeed([])
    expect(result.rowCount).toBe(0)
    expect(result.csv.split('\r\n').filter(Boolean)).toHaveLength(1)
  })

  it('truncates a title past Facebook’s limit rather than being rejected', () => {
    const { csv } = buildFacebookFeed([{ ...base, title: 'x'.repeat(400) }])
    const titleCell = csv.split('\r\n')[1]!.split('","')[1]!
    expect(titleCell.length).toBeLessThanOrEqual(150)
  })
})
