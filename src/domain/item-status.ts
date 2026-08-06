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
  ai_identified: ['needs_confirmation', 'photos_needed', 'discarded'],
  needs_confirmation: ['confirmed', 'photos_needed', 'ai_identified', 'discarded'],
  confirmed: ['listed', 'needs_confirmation', 'discarded'],
  listed: ['sold', 'confirmed', 'discarded'],
  sold: [],
  discarded: ['photos_needed'],
}

export const statusLabels: Record<ItemStatus, string> = {
  detected: 'Detected',
  photos_needed: 'Photos needed',
  ai_identified: 'AI identified',
  needs_confirmation: 'Needs confirmation',
  confirmed: 'Ready to list',
  listed: 'Listed',
  sold: 'Sold',
  discarded: 'Discarded',
}

/** Dashboard ordering: what needs the seller's attention comes first. */
export const statusOrder: readonly ItemStatus[] = [
  'photos_needed',
  'needs_confirmation',
  'ai_identified',
  'detected',
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

export interface StatusSignals {
  /** True when every required view for the item's category has been captured. */
  coverageComplete: boolean
}

/**
 * Suggests a status after an item's photos change.
 *
 * This deliberately only moves items between machine-owned states. Once a
 * person has confirmed, listed, or sold an item, adding a photo must not
 * quietly walk it backwards — the user's decision outranks the heuristic.
 */
export function deriveStatus(current: ItemStatus, signals: StatusSignals): ItemStatus {
  const machineOwned: readonly ItemStatus[] = [
    'detected',
    'photos_needed',
    'ai_identified',
    'needs_confirmation',
  ]
  if (!machineOwned.includes(current)) return current

  return signals.coverageComplete ? 'needs_confirmation' : 'photos_needed'
}

/** Statuses whose items still need work before they can be listed. */
export function isActionable(status: ItemStatus): boolean {
  return (
    status === 'detected' ||
    status === 'photos_needed' ||
    status === 'ai_identified' ||
    status === 'needs_confirmation'
  )
}
