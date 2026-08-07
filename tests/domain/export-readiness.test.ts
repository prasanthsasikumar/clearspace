import { describe, expect, it } from 'vitest'
import { exportReadiness, type ReadinessInput } from '@/domain/export-readiness'

const approved: ReadinessInput = {
  status: 'confirmed',
  title: 'Lounge chair',
  estimatedValueCents: 14000,
  condition: 'good',
}

describe('exportReadiness', () => {
  it('is ready when the export has everything it needs', () => {
    expect(exportReadiness(approved)).toEqual({ ready: true, blocker: null })
  })

  /*
   * The bug this exists for. Approving an item sets `confirmed`, which the
   * board used to label "Ready to export" on its own, so a lot where nothing
   * had been priced showed a ready item and then exported nothing at all.
   */
  it('is not ready, and says why, when an approved item has no price', () => {
    expect(exportReadiness({ ...approved, estimatedValueCents: null })).toEqual({
      ready: false,
      blocker: 'Needs a price',
    })
  })

  it('treats a zero price as no price, matching what the export does', () => {
    expect(exportReadiness({ ...approved, estimatedValueCents: 0 }).blocker).toBe('Needs a price')
  })

  it('names a missing condition, which Marketplace also requires', () => {
    expect(exportReadiness({ ...approved, condition: null }).blocker).toBe('Needs a condition')
  })

  it('names a missing title', () => {
    expect(exportReadiness({ ...approved, title: '  ' }).blocker).toBe('Needs a title')
  })

  it('counts an exported item as ready, since it already went out', () => {
    expect(exportReadiness({ ...approved, status: 'listed' }).ready).toBe(true)
  })

  /*
   * A draft has its own status to show and nobody has decided about it yet.
   * Listing what it is missing would put a warning on every card in a fresh
   * lot, which is noise rather than information.
   */
  it('stays quiet about drafts rather than warning on every card', () => {
    for (const status of ['detected', 'ai_identified', 'needs_confirmation', 'photos_needed'] as const) {
      expect(exportReadiness({ ...approved, status, estimatedValueCents: null })).toEqual({
        ready: false,
        blocker: null,
      })
    }
  })

  it('stays quiet about binned items', () => {
    expect(exportReadiness({ ...approved, status: 'discarded' })).toEqual({
      ready: false,
      blocker: null,
    })
  })
})
