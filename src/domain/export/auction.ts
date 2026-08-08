import type { ItemCondition } from '@/db/schema'
import { toCsv } from './csv'

/**
 * A lot catalogue for an online auction platform.
 *
 * The unit here is a lot, not a listing, and the difference runs through every
 * column. A listing has one price a buyer pays; a lot has a range the
 * auctioneer publishes as guidance and a reserve they may not go below. So
 * this file reads the valuation's low and high directly rather than the single
 * recommended figure the Marketplace exports flatten it to.
 *
 * PROVISIONAL HEADERS. These names are a field set, not a verified HiBid /
 * Auction Flex import template. Reconcile them against a real template before
 * a generated file is sent to an auction house. The rest of this module — the
 * skip rules, the dollar conversion, the photo references — is independent of
 * what the columns end up being called, so that reconciliation is a change to
 * the two constants below and nothing else.
 */
export const AUCTION_COLUMNS = [
  'lot',
  'title',
  'description',
  'condition',
  'estimate_low',
  'estimate_high',
  'reserve',
  'category',
  'quantity',
  'photos',
] as const

/** The enum spells these for a database; an auctioneer reads them in a sheet. */
const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New',
  like_new: 'Like new',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  for_parts: 'For parts',
}

/**
 * Photo filenames in one cell, pipe-separated.
 *
 * A comma would be indistinguishable from a column break to anyone opening
 * the file by eye, which is how most import problems get diagnosed.
 */
const PHOTO_SEPARATOR = '|'

export interface AuctionItem {
  id: string
  lotNumber: number
  title: string
  description: string | null
  condition: ItemCondition | null
  lowCents: number | null
  highCents: number | null
  reserveCents: number | null
  category: string | null
  /** Names of entries in the same archive as this CSV. */
  photoFilenames: readonly string[]
}

export interface AuctionWarning {
  itemId: string
  field: string
  message: string
}

export interface AuctionResult {
  csv: string
  rowCount: number
  skipped: AuctionWarning[]
  warnings: AuctionWarning[]
}

/** Whole dollars. Auction estimates are not quoted to the cent. */
function dollars(cents: number): number {
  return Math.round(cents / 100)
}

/**
 * Builds the catalogue, and reports what it could not carry.
 *
 * An item with no valuation is left out rather than sent with a range derived
 * from the single estimated value by applying some spread. That spread would
 * be invented, and an invented range in an auction catalogue is a number the
 * auctioneer would reasonably believe someone had researched.
 */
export function buildAuctionCatalog(
  items: readonly AuctionItem[],
): AuctionResult {
  const rows: (string | number | null)[][] = []
  const skipped: AuctionWarning[] = []
  const warnings: AuctionWarning[] = []

  for (const item of items) {
    const title = item.title.trim()

    if (!title) {
      skipped.push({
        itemId: item.id,
        field: 'title',
        message: `Lot ${item.lotNumber} has no title, so it was left out.`,
      })
      continue
    }

    if (item.lowCents === null || item.highCents === null) {
      skipped.push({
        itemId: item.id,
        field: 'estimate',
        message: `“${title}” has no estimate yet, so it was left out.`,
      })
      continue
    }

    if (item.condition === null) {
      warnings.push({
        itemId: item.id,
        field: 'condition',
        message: `“${title}” has no condition set.`,
      })
    }

    if (item.photoFilenames.length === 0) {
      warnings.push({
        itemId: item.id,
        field: 'photos',
        message: `“${title}” has no photographs, and an unphotographed lot does not sell.`,
      })
    }

    rows.push([
      item.lotNumber,
      title,
      item.description ?? '',
      item.condition === null ? '' : CONDITION_LABELS[item.condition],
      dollars(item.lowCents),
      dollars(item.highCents),
      item.reserveCents === null ? null : dollars(item.reserveCents),
      item.category ?? '',
      1,
      item.photoFilenames.join(PHOTO_SEPARATOR),
    ])
  }

  return {
    csv: toCsv(AUCTION_COLUMNS, rows),
    rowCount: rows.length,
    skipped,
    warnings,
  }
}
