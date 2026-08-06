import { describe, expect, it } from 'vitest'
import {
  InvalidStatusTransitionError,
  assertTransition,
  canTransition,
  deriveStatus,
  isActionable,
  statusOrder,
} from '@/domain/item-status'

describe('canTransition', () => {
  it('allows the normal path through the pipeline', () => {
    expect(canTransition('detected', 'photos_needed')).toBe(true)
    expect(canTransition('photos_needed', 'needs_confirmation')).toBe(true)
    expect(canTransition('needs_confirmation', 'confirmed')).toBe(true)
    expect(canTransition('confirmed', 'listed')).toBe(true)
    expect(canTransition('listed', 'sold')).toBe(true)
  })

  it('refuses to skip confirmation on the way to a listing', () => {
    expect(canTransition('photos_needed', 'listed')).toBe(false)
    expect(canTransition('detected', 'sold')).toBe(false)
  })

  it('treats sold as terminal', () => {
    expect(canTransition('sold', 'listed')).toBe(false)
    expect(canTransition('sold', 'discarded')).toBe(false)
  })

  it('permits a no-op transition', () => {
    expect(canTransition('confirmed', 'confirmed')).toBe(true)
  })

  it('lets a discarded item be picked back up', () => {
    expect(canTransition('discarded', 'photos_needed')).toBe(true)
  })
})

describe('assertTransition', () => {
  it('throws an error naming both ends in the seller’s vocabulary', () => {
    expect(() => assertTransition('detected', 'sold')).toThrow(InvalidStatusTransitionError)
    expect(() => assertTransition('detected', 'sold')).toThrow(/Detected.*Sold/)
  })
})

describe('deriveStatus', () => {
  it('asks for photos while coverage is incomplete', () => {
    expect(deriveStatus('detected', { coverageComplete: false })).toBe('photos_needed')
  })

  it('moves to confirmation once the required views exist', () => {
    expect(deriveStatus('photos_needed', { coverageComplete: true })).toBe('needs_confirmation')
  })

  it('never walks back a decision the user already made', () => {
    for (const status of ['confirmed', 'listed', 'sold', 'discarded'] as const) {
      expect(deriveStatus(status, { coverageComplete: false })).toBe(status)
    }
  })
})

describe('statusOrder', () => {
  it('puts the statuses needing attention first', () => {
    expect(statusOrder[0]).toBe('photos_needed')
    expect(statusOrder.indexOf('photos_needed')).toBeLessThan(statusOrder.indexOf('confirmed'))
    expect(statusOrder.indexOf('sold')).toBeLessThan(statusOrder.indexOf('discarded'))
  })
})

describe('isActionable', () => {
  it('counts only the statuses that still need work', () => {
    expect(isActionable('photos_needed')).toBe(true)
    expect(isActionable('needs_confirmation')).toBe(true)
    expect(isActionable('confirmed')).toBe(false)
    expect(isActionable('sold')).toBe(false)
  })
})
