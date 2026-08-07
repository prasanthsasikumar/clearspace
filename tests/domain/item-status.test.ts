import { describe, expect, it } from 'vitest'
import {
  InvalidStatusTransitionError,
  assertTransition,
  canTransition,
  deriveStatus,
  isActionable,
  isDraft,
  needsReview,
  statusOrder,
} from '@/domain/item-status'

describe('canTransition', () => {
  it('allows the normal path through the pipeline', () => {
    expect(canTransition('detected', 'needs_confirmation')).toBe(true)
    expect(canTransition('needs_confirmation', 'ai_identified')).toBe(true)
    expect(canTransition('needs_confirmation', 'confirmed')).toBe(true)
    expect(canTransition('confirmed', 'listed')).toBe(true)
    expect(canTransition('listed', 'sold')).toBe(true)
  })

  it('lets a written listing be approved in one tap', () => {
    // The main act on the listings screen. Routing approval back through a
    // second draft state would make saying yes cost two taps.
    expect(canTransition('ai_identified', 'confirmed')).toBe(true)
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
    expect(() => assertTransition('detected', 'sold')).toThrow(/Draft.*Sold/)
  })
})

describe('deriveStatus', () => {
  it('makes a freshly detected item reviewable without demanding more photos', () => {
    // The whole point of the bulk loop: one photograph is enough to get a
    // draft. Anything that answers a single photo with "Photos needed" has
    // refused to do the job.
    expect(deriveStatus('detected')).toBe('needs_confirmation')
    expect(deriveStatus('photos_needed')).toBe('needs_confirmation')
  })

  it('leaves a drafted item alone', () => {
    expect(deriveStatus('needs_confirmation')).toBe('needs_confirmation')
  })

  it('never walks back a decision the user or the model already made', () => {
    for (const status of ['ai_identified', 'confirmed', 'listed', 'sold', 'discarded'] as const) {
      expect(deriveStatus(status)).toBe(status)
    }
  })
})

describe('isDraft / needsReview', () => {
  it('separates items awaiting approval from items awaiting a read-through', () => {
    expect(isDraft('needs_confirmation')).toBe(true)
    expect(isDraft('detected')).toBe(true)
    expect(isDraft('ai_identified')).toBe(false)

    expect(needsReview('ai_identified')).toBe(true)
    expect(needsReview('confirmed')).toBe(false)
  })
})

describe('statusOrder', () => {
  it('puts listings awaiting a read-through first', () => {
    expect(statusOrder[0]).toBe('ai_identified')
    expect(statusOrder.indexOf('ai_identified')).toBeLessThan(
      statusOrder.indexOf('needs_confirmation'),
    )
    expect(statusOrder.indexOf('needs_confirmation')).toBeLessThan(
      statusOrder.indexOf('confirmed'),
    )
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
