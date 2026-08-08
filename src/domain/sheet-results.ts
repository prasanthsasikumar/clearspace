/**
 * Turning one model reply about a numbered sheet back into per-item facts.
 *
 * The whole point of a contact sheet is that a lot costs one call instead of
 * fifty, and the cost of that is a number: the model answers about tile 7, and
 * nothing but that 7 says which item it meant. A model that miscounts, repeats
 * a number, or invents one past the end of the sheet would otherwise write a
 * lamp's price onto a drill.
 *
 * So none of it is trusted. Anything out of range, duplicated, or missing is
 * dropped, and a dropped item keeps whatever it already had rather than
 * receiving a guess meant for something else. This mirrors `applyGrouping`,
 * which repairs the matcher's replies on the same assumption: the model is
 * useful and occasionally wrong, and correctness is this side's job.
 */

export interface SheetRow {
  /** 1-based tile number, as printed on the sheet. */
  n: number
  title?: string | null
  category?: string | null
  condition?: string | null
  priceCents?: number | null
  description?: string | null
}

export interface SheetAssignment<T> {
  itemId: string
  row: T
}

export interface SheetOutcome<T> {
  assigned: SheetAssignment<T>[]
  /** Items the reply said nothing usable about. */
  unmatched: string[]
}

/**
 * Maps rows onto the ids they were built from, in sheet order.
 *
 * `order[0]` is tile 1, because the sheet is numbered for a human reading it
 * and off-by-one here is silent and expensive.
 */
export function assignSheetRows<T extends SheetRow>(
  order: readonly string[],
  rows: readonly T[],
): SheetOutcome<T> {
  const taken = new Set<number>()
  const assigned: SheetAssignment<T>[] = []

  for (const row of rows) {
    if (!Number.isInteger(row.n)) continue
    const index = row.n - 1
    if (index < 0 || index >= order.length) continue
    // First answer for a tile wins. A second is the model contradicting
    // itself, and there is no way to tell which of the two it meant.
    if (taken.has(index)) continue
    taken.add(index)
    assigned.push({ itemId: order[index]!, row })
  }

  const unmatched = order.filter((_, i) => !taken.has(i))
  return { assigned, unmatched }
}

/**
 * A price is only worth taking if it is a positive whole number of cents.
 *
 * Zero is the failure that matters: an item priced at nothing is dropped from
 * every export, so accepting a zero would quietly delete something from the
 * seller's inventory rather than leave it visibly unpriced.
 */
export function usablePriceCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const cents = Math.round(value)
  return cents > 0 ? cents : null
}
