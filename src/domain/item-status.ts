import type { ItemStatus } from '@/db/schema'

/**
 * The item lifecycle.
 *
 * Statuses are the vocabulary the inventory dashboard groups by, so they are
 * phrased from the seller's point of view — "what do I still have to do with
 * this?" — rather than as pipeline internals.
 */
const ALLOWED_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  detected: ['photos_needed', 'needs_confirmation', 'discarded'],
  photos_needed: ['ai_identified', 'needs_confirmation', 'discarded'],
  // Approving a written listing is the main act on the listings screen, so it
  // goes straight to `confirmed` — routing it back through a second draft
  // state would mean two taps to say yes once.
  ai_identified: ['confirmed', 'needs_confirmation', 'photos_needed', 'discarded'],
  needs_confirmation: ['confirmed', 'photos_needed', 'ai_identified', 'discarded'],
  confirmed: ['listed', 'needs_confirmation', 'discarded'],
  listed: ['sold', 'confirmed', 'discarded'],
  sold: [],
  discarded: ['photos_needed'],
}

export const statusLabels: Record<ItemStatus, string> = {
  detected: 'Draft',
  photos_needed: 'Add photos',
  ai_identified: 'Review listing',
  needs_confirmation: 'Draft',
  confirmed: 'Ready to export',
  listed: 'Exported',
  sold: 'Sold',
  discarded: 'Binned',
}

/** Board ordering: what needs the seller's attention comes first. */
export const statusOrder: readonly ItemStatus[] = [
  'ai_identified',
  'needs_confirmation',
  'detected',
  'photos_needed',
  'confirmed',
  'listed',
  'sold',
  'discarded',
]

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  if (from === to) return true
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export class InvalidStatusTransitionError extends Error {
  constructor(
    readonly from: ItemStatus,
    readonly to: ItemStatus,
  ) {
    super(`Cannot move an item from "${statusLabels[from]}" to "${statusLabels[to]}"`)
    this.name = 'InvalidStatusTransitionError'
  }
}

export function assertTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransition(from, to)) throw new InvalidStatusTransitionError(from, to)
}

/**
 * Promotes a freshly grouped item to a reviewable draft.
 *
 * Photo coverage deliberately no longer decides status. Someone standing in a
 * unit with five minutes often has exactly one photograph of a thing, and an
 * app that answers that with "Photos needed" has refused to do the one job it
 * exists for. The shot list survives as advice on the item screen — adding a
 * label shot genuinely helps a listing sell — but it never blocks anything.
 *
 * Only the two machine-owned drafting states move here. Once a person has
 * reviewed, exported, or sold an item, nothing automatic may walk it backwards.
 */
export function deriveStatus(current: ItemStatus): ItemStatus {
  const drafting: readonly ItemStatus[] = ['detected', 'photos_needed']
  return drafting.includes(current) ? 'needs_confirmation' : current
}

/** Items the board should preselect for the user to approve in bulk. */
export function isDraft(status: ItemStatus): boolean {
  return status === 'detected' || status === 'photos_needed' || status === 'needs_confirmation'
}

/** Items carrying a generated listing that the user has not yet checked. */
export function needsReview(status: ItemStatus): boolean {
  return status === 'ai_identified'
}

/** Statuses whose items still want something from the seller. */
export function isActionable(status: ItemStatus): boolean {
  return isDraft(status) || needsReview(status)
}
