import type { ItemCondition } from '@/db/schema'
import { toCsv } from './csv'

/**
 * Facebook's product catalogue data feed.
 *
 * A necessary clarification, because the difference costs people hours: there
 * is no bulk import for *personal* Marketplace listings. This file is the
 * Commerce Manager catalogue feed format, which is what Facebook actually
 * documents and accepts, and it requires a business catalogue. A private seller
 * clearing a garage lists through the app, and for them the useful export is
 * the share sheet (photos and copy in one tap), not this file.
 *
 * So this exists to be correct for the people it fits, and the UI says plainly
 * who those people are rather than implying one tap posts to Marketplace.
 *
 * Column names and value vocabularies below follow Facebook's documented feed
 * spec; `id`, `title`, `description`, `availability`, `condition`, `price`,
 * `link`, and `image_link` are the required set.
 */
export const FACEBOOK_COLUMNS = [
  'id',
  'title',
  'description',
  'availability',
  'condition',
  'price',
  'link',
  'image_link',
  'additional_image_link',
  'brand',
  'product_type',
  'quantity_to_sell_on_facebook',
] as const

/** Facebook accepts exactly these condition values. */
const CONDITION: Record<ItemCondition, string> = {
  new: 'new',
  like_new: 'used_like_new',
  excellent: 'used_like_new',
  good: 'used_good',
  fair: 'used_fair',
  poor: 'used_fair',
  for_parts: 'used_fair',
}

export interface ExportableItem {
  id: string
  title: string
  description: string | null
  condition: ItemCondition | null
  priceCents: number | null
  currency: string
  brand: string | null
  category: string | null
  /** Absolute, publicly reachable URLs. */
  imageUrls: readonly string[]
  itemUrl: string
}

export interface ExportWarning {
  itemId: string
  field: string
  message: string
}

export interface ExportResult {
  csv: string
  rowCount: number
  skipped: ExportWarning[]
  warnings: ExportWarning[]
}

/**
 * Builds the feed, and reports what it could not vouch for.
 *
 * Items with no price are skipped rather than exported at zero: a catalogue
 * row priced at 0.00 is worse than an absent one. Everything else that is
 * merely incomplete produces a warning the UI shows, so the seller finds out
 * here rather than from a rejected upload.
 */
export function buildFacebookFeed(items: readonly ExportableItem[]): ExportResult {
  const rows: (string | number | null)[][] = []
  const skipped: ExportWarning[] = []
  const warnings: ExportWarning[] = []

  for (const item of items) {
    if (item.priceCents === null || item.priceCents <= 0) {
      skipped.push({
        itemId: item.id,
        field: 'price',
        message: `“${item.title}” has no price, so it was left out.`,
      })
      continue
    }
    if (item.imageUrls.length === 0) {
      skipped.push({
        itemId: item.id,
        field: 'image_link',
        message: `“${item.title}” has no photo, so it was left out.`,
      })
      continue
    }
    if (!item.description) {
      warnings.push({
        itemId: item.id,
        field: 'description',
        message: `“${item.title}” has no description yet.`,
      })
    }
    if (!item.brand) {
      warnings.push({
        itemId: item.id,
        field: 'brand',
        message: `“${item.title}” has no brand. Facebook wants one.`,
      })
    }

    rows.push([
      item.id,
      truncate(item.title, 150),
      truncate(item.description ?? item.title, 5000),
      'in stock',
      CONDITION[item.condition ?? 'good'],
      formatPrice(item.priceCents, item.currency),
      item.itemUrl,
      item.imageUrls[0] ?? '',
      // Facebook takes additional images as a comma-separated list, capped at
      // 20; ours are capped by how many views grouping found.
      item.imageUrls.slice(1, 21).join(','),
      item.brand ?? '',
      item.category ?? '',
      1,
    ])
  }

  return { csv: toCsv(FACEBOOK_COLUMNS, rows), rowCount: rows.length, skipped, warnings }
}

/** Facebook wants `9.99 USD`: amount, space, ISO currency code. */
export function formatPrice(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
