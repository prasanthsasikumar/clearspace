/**
 * Lot numbers, assigned at export rather than at detection.
 *
 * Two properties matter, and both come from the same rule. The CSV and the
 * photo filenames are produced from one ordering in one pass, so a filename
 * cannot drift away from the row that references it. And a number, once given,
 * is kept: an auctioneer who has published a catalogue and then adds two more
 * items must not find the first forty renumbered underneath them.
 *
 * Ordering is the caller's business. The service passes items in createdAt
 * order; this function only decides who gets which number.
 */

export interface NumberableItem {
  id: string
  lotNumber: number | null
}

/** Keyed by item id, with an entry for every item passed in. */
export function assignLotNumbers(
  items: readonly NumberableItem[],
): Map<string, number> {
  const assigned = new Map<string, number>()

  let next = 0
  for (const item of items) {
    if (item.lotNumber !== null) next = Math.max(next, item.lotNumber)
  }

  for (const item of items) {
    if (item.lotNumber !== null) {
      assigned.set(item.id, item.lotNumber)
      continue
    }
    next += 1
    assigned.set(item.id, next)
  }

  return assigned
}
