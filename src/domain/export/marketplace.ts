import type { ItemCondition } from '@/db/schema'
import type { CellValue } from '@/lib/xlsx'

/**
 * Facebook Marketplace bulk upload.
 *
 * A different product from the catalogue feed in `facebook.ts`, and the one
 * this app's users actually need: the feed wants a Commerce Manager business
 * catalogue, while this is the template a private seller clearing a garage
 * fills in and hands back. Five columns, fifty listings, returned as a
 * workbook rather than a CSV.
 */

/** The template's own cap, stated in its second row. */
export const MAX_LISTINGS = 50

const MAX_TITLE = 150
const MAX_DESCRIPTION = 5000

/**
 * The four values the template's dropdown accepts, verbatim.
 *
 * The file contradicts itself here. Its help row reads `"New"; "Used - Like
 * New"; "Used - Good"; "Used - Fair"` with hyphens and title case, while the
 * VALIDATION sheet behind the dropdown carries an EN DASH (U+2013) and lower
 * case. The validation list is the machine-readable half, so it wins.
 *
 * Those dashes are load-bearing data, not prose. Do not "fix" them.
 */
export const CONDITIONS = {
  new: 'New',
  like_new: 'Used – like new',
  good: 'Used – good',
  fair: 'Used – fair',
} as const

/**
 * Seven conditions collapsed into four.
 *
 * Both ends of the app's scale fold inward: `excellent` is not a Marketplace
 * value and reads as `good`, and `poor` and `for_parts` land on `fair` because
 * it is the lowest thing the template can say. That last one is a downgrade
 * worth surfacing, since a for-parts item listed as "fair" invites a dispute.
 */
const CONDITION_MAP: Record<ItemCondition, keyof typeof CONDITIONS> = {
  new: 'new',
  like_new: 'like_new',
  excellent: 'good',
  good: 'good',
  fair: 'fair',
  poor: 'fair',
  for_parts: 'fair',
}

/** Rows 1 to 4 of the template, reproduced exactly, typo included. */
const PREAMBLE: CellValue[][] = [
  ['Facebook Marketplace Bulk Upload Template'],
  [
    'You can create up to 50 listings at once. When you are finished, be sure to save or export this as an XLS/XLSX file.',
  ],
  [
    'REQUIRED | Plain text (up to 150 characters',
    'REQUIRED | A whole number in $',
    'REQUIRED | Supported values: "New"; "Used - Like New"; "Used - Good"; "Used - Fair"',
    'OPTIONAL | Plain text (up to 5000 characters)',
    'OPTIONAL | Type of listing',
  ],
  ['TITLE', 'PRICE', 'CONDITION', 'DESCRIPTION', 'CATEGORY'],
]

export interface MarketplaceItem {
  id: string
  title: string
  priceCents: number | null
  condition: ItemCondition | null
  description: string | null
}

export interface MarketplaceWarning {
  itemId: string
  field: string
  message: string
}

export interface MarketplaceResult {
  rows: CellValue[][]
  rowCount: number
  skipped: MarketplaceWarning[]
  warnings: MarketplaceWarning[]
}

/**
 * Builds the sheet, and reports what it could not carry.
 *
 * Title, price, and condition are all required, so an item missing any of them
 * is left out rather than sent with a blank the upload would reject. Price is
 * a whole number of dollars: the template has no cents column, so
 * is rounded rather than truncated, and anything that rounds to zero is
 * dropped, because a free listing is not what the seller meant.
 *
 * CATEGORY is left empty on purpose. Every valid value is a full path like
 * `Furniture//Bedroom Furniture//Dressers`, and this app's categories are
 * fifteen coarse buckets; there is no honest mapping from one to the other, and
 * guessing a leaf would put a chair under wardrobes. The column is optional.
 */
export function buildMarketplaceSheet(
  items: readonly MarketplaceItem[],
): MarketplaceResult {
  const rows: CellValue[][] = PREAMBLE.map((row) => [...row])
  const skipped: MarketplaceWarning[] = []
  const warnings: MarketplaceWarning[] = []

  for (const item of items) {
    if (rows.length - PREAMBLE.length >= MAX_LISTINGS) {
      skipped.push({
        itemId: item.id,
        field: 'limit',
        message: `“${item.title}” is past the ${MAX_LISTINGS}-listing limit for one upload.`,
      })
      continue
    }

    const title = item.title.trim()
    if (!title) {
      skipped.push({ itemId: item.id, field: 'title', message: 'An item with no title was left out.' })
      continue
    }

    const dollars = item.priceCents === null ? null : Math.round(item.priceCents / 100)
    if (dollars === null || dollars <= 0) {
      skipped.push({
        itemId: item.id,
        field: 'price',
        message: `“${title}” has no price, so it was left out.`,
      })
      continue
    }

    if (item.condition === null) {
      skipped.push({
        itemId: item.id,
        field: 'condition',
        message: `“${title}” has no condition set, and Marketplace requires one.`,
      })
      continue
    }

    if (item.condition === 'poor' || item.condition === 'for_parts') {
      warnings.push({
        itemId: item.id,
        field: 'condition',
        message: `“${title}” is listed as fair, the lowest Marketplace allows. Say so in the description.`,
      })
    }

    if (title.length > MAX_TITLE) {
      warnings.push({
        itemId: item.id,
        field: 'title',
        message: `“${title.slice(0, 40)}…” was shortened to ${MAX_TITLE} characters.`,
      })
    }

    if (!item.description) {
      warnings.push({
        itemId: item.id,
        field: 'description',
        message: `“${title}” has no description yet.`,
      })
    }

    rows.push([
      title.slice(0, MAX_TITLE),
      dollars,
      CONDITIONS[CONDITION_MAP[item.condition]],
      (item.description ?? '').slice(0, MAX_DESCRIPTION),
      // CATEGORY: deliberately blank. See the note above.
      null,
    ])
  }

  return { rows, rowCount: rows.length - PREAMBLE.length, skipped, warnings }
}
