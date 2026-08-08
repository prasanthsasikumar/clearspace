import { describe, expect, it } from 'vitest'
import { AUCTION_COLUMNS, buildAuctionCatalog, type AuctionItem } from '@/domain/export/auction'

const base: AuctionItem = {
  id: 'item-1',
  lotNumber: 1,
  title: 'Walnut sideboard',
  description: 'Mid-century, four drawers.',
  condition: 'good',
  lowCents: 12000,
  highCents: 18000,
  reserveCents: null,
  category: 'furniture',
  photoFilenames: ['1_1.jpg', '1_2.jpg'],
}

describe('buildAuctionCatalog', () => {
  it('writes a header row and one row per lot', () => {
    const result = buildAuctionCatalog([base])
    const lines = result.csv.trimEnd().split('\r\n')

    expect(lines[0]).toContain(AUCTION_COLUMNS[0]!)
    expect(lines).toHaveLength(2)
    expect(result.rowCount).toBe(1)
  })

  it('carries the estimate range as whole dollars, not cents', () => {
    const result = buildAuctionCatalog([base])
    expect(result.csv).toContain('"120"')
    expect(result.csv).toContain('"180"')
  })

  it('skips an item with no estimate rather than inventing a range', () => {
    const result = buildAuctionCatalog([
      { ...base, lowCents: null, highCents: null },
    ])

    expect(result.rowCount).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]!.field).toBe('estimate')
    expect(result.skipped[0]!.message).toContain('Walnut sideboard')
  })

  /*
   * `valuations.lowCents`/`highCents` are NOT NULL and enrichment clamps
   * rather than rejects, so a model that answers "$0" for a low-value item
   * writes a real 0 — and a $0-$0 row is exactly the invented-looking number
   * this skip check exists to keep out of the catalogue.
   */
  it('skips an item priced at zero rather than exporting a researched-looking $0-$0', () => {
    const result = buildAuctionCatalog([{ ...base, lowCents: 0, highCents: 0 }])

    expect(result.rowCount).toBe(0)
    expect(result.skipped[0]!.field).toBe('estimate')
  })

  it('skips an item with a negative estimate the same way', () => {
    const low = buildAuctionCatalog([{ ...base, lowCents: -100, highCents: 500 }])
    expect(low.skipped[0]!.field).toBe('estimate')

    const high = buildAuctionCatalog([{ ...base, lowCents: 500, highCents: -100 }])
    expect(high.skipped[0]!.field).toBe('estimate')
  })

  it('skips an untitled item', () => {
    const result = buildAuctionCatalog([{ ...base, title: '   ' }])
    expect(result.rowCount).toBe(0)
    expect(result.skipped[0]!.field).toBe('title')
  })

  it('leaves the reserve column empty when nobody set one', () => {
    const withReserve = buildAuctionCatalog([{ ...base, reserveCents: 10000 }])
    expect(withReserve.csv).toContain('"100"')

    const without = buildAuctionCatalog([base])
    // Split on quoted RFC 4180 cells, not on every comma: the description
    // fixture itself contains one ("Mid-century, four drawers."), and a naive
    // `.split(',')` would misalign every cell after it.
    const cells = without.csv.trimEnd().split('\r\n')[1]!.match(/"(?:[^"]|"")*"/g)!
    const reserveIndex = AUCTION_COLUMNS.indexOf('reserve')
    expect(cells[reserveIndex]).toBe('""')
  })

  it('joins photo filenames so the row points at entries in the same archive', () => {
    const result = buildAuctionCatalog([base])
    expect(result.csv).toContain('1_1.jpg|1_2.jpg')
  })

  it('warns when a lot has no photographs, since it will not sell', () => {
    const result = buildAuctionCatalog([{ ...base, photoFilenames: [] }])
    expect(result.rowCount).toBe(1)
    expect(result.warnings[0]!.field).toBe('photos')
  })

  it('escapes the quotes and newlines a description is full of', () => {
    const result = buildAuctionCatalog([
      { ...base, description: 'He said "mint", then\nadded a caveat.' },
    ])
    expect(result.csv).toContain('""mint""')
  })

  it('renders a condition the enum spells with an underscore as words', () => {
    const result = buildAuctionCatalog([{ ...base, condition: 'for_parts' }])
    expect(result.csv).toContain('For parts')
  })

  it('handles an empty lot without producing a headerless file', () => {
    const result = buildAuctionCatalog([])
    expect(result.rowCount).toBe(0)
    expect(result.csv).toContain(AUCTION_COLUMNS[0]!)
  })
})
