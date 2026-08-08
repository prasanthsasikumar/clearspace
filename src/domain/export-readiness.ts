import type { ItemCondition, ItemStatus } from '@/db/schema'

/**
 * Whether an item would actually survive an export, and what stops it.
 *
 * Status and readiness are different claims, and conflating them is how the
 * board came to show "Ready to export" on an item with no price. `confirmed`
 * means a person looked at the identification and said yes; it is set by the
 * approve action and by Confirm details, neither of which knows or cares what
 * the thing costs. The Marketplace sheet needs a title, a price, and a
 * condition, so an item can sit confirmed for as long as it likes and still be
 * left out of the file.
 *
 * The board asks this instead of reading the status, so the card can only
 * promise an export it can keep.
 */

export interface ExportReadiness {
  /** True when nothing stands between this item and a row in the sheet. */
  ready: boolean
  /** The first thing missing, phrased for a chip. Null when ready. */
  blocker: string | null
}

export interface ReadinessInput {
  status: ItemStatus
  title: string | null
  estimatedValueCents: number | null
  condition: ItemCondition | null
}

/** Statuses that mean the seller has finished deciding about this item. */
function isApproved(status: ItemStatus): boolean {
  return status === 'confirmed' || status === 'listed'
}

export function exportReadiness(item: ReadinessInput): ExportReadiness {
  if (item.status === 'discarded') return { ready: false, blocker: null }

  // Before approval the card has its own status to show, and listing what is
  // missing on a draft nobody has looked at yet would be noise on every card.
  if (!isApproved(item.status)) return { ready: false, blocker: null }

  if (!item.title?.trim()) return { ready: false, blocker: 'Needs a title' }
  // A price of zero is not a price: the export drops it rather than listing
  // the thing free, so the board should not call it ready either.
  if (item.estimatedValueCents === null || item.estimatedValueCents <= 0) {
    return { ready: false, blocker: 'Needs a price' }
  }
  if (item.condition === null) return { ready: false, blocker: 'Needs a condition' }

  return { ready: true, blocker: null }
}

export interface AuctionReadinessInput {
  status: ItemStatus
  title: string | null
  lowCents: number | null
  highCents: number | null
}

/**
 * The same question as `exportReadiness`, asked of the auction catalogue.
 *
 * It is a separate function rather than a flag because the requirements
 * genuinely differ: a lot needs a published estimate range where a listing
 * needs one price, and condition is optional here because an auctioneer grades
 * goods themselves and would rather see a blank than the app's guess.
 */
export function auctionReadiness(item: AuctionReadinessInput): ExportReadiness {
  if (item.status === 'discarded') return { ready: false, blocker: null }
  if (!isApproved(item.status)) return { ready: false, blocker: null }

  if (!item.title?.trim()) return { ready: false, blocker: 'Needs a title' }
  // A zero-or-under estimate is not an estimate, matching the auction export's
  // own skip rule and the "a price of zero is not a price" call made above.
  if (
    item.lowCents === null ||
    item.highCents === null ||
    item.lowCents <= 0 ||
    item.highCents <= 0
  ) {
    return { ready: false, blocker: 'Needs an estimate' }
  }

  return { ready: true, blocker: null }
}
