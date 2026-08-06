import { describe, expect, it } from 'vitest'
import { evaluateCoverage, requirementsFor } from '@/domain/coverage'

describe('requirementsFor', () => {
  it('asks electronics for a serial number and furniture for damage', () => {
    const electronics = requirementsFor('electronics').map((r) => r.view)
    const furniture = requirementsFor('furniture').map((r) => r.view)

    expect(electronics).toContain('serial')
    expect(furniture).not.toContain('serial')
    expect(furniture).toContain('damage')
  })

  it('falls back to the generic list for an unknown category', () => {
    expect(requirementsFor(null).map((r) => r.view)).toEqual(['front', 'side', 'damage'])
  })

  it('always leads with the front view', () => {
    for (const category of ['tools', 'apparel', 'jewelry', 'books_media'] as const) {
      expect(requirementsFor(category)[0]?.view).toBe('front')
    }
  })

  it('gives every requirement an actionable prompt and a reason', () => {
    for (const requirement of requirementsFor('musical_instruments')) {
      expect(requirement.prompt.length).toBeGreaterThan(0)
      expect(requirement.rationale.length).toBeGreaterThan(0)
    }
  })
})

describe('evaluateCoverage', () => {
  it('reports every required view as missing when there are no photos', () => {
    const result = evaluateCoverage('electronics', [])
    expect(result.isListable).toBe(false)
    expect(result.completeness).toBe(0)
    expect(result.next?.view).toBe('front')
  })

  it('becomes listable once the required views are captured', () => {
    const result = evaluateCoverage('furniture', [
      { view: 'front' },
      { view: 'side' },
      { view: 'damage' },
    ])
    expect(result.isListable).toBe(true)
    expect(result.missingRequired).toHaveLength(0)
    // The maker tag is recommended, so it is still suggested next.
    expect(result.next?.view).toBe('label')
  })

  it('does not count a photo the quality check rejected', () => {
    const result = evaluateCoverage('furniture', [
      { view: 'front', usable: false },
      { view: 'side' },
      { view: 'damage' },
    ])
    expect(result.isListable).toBe(false)
    expect(result.next?.view).toBe('front')
  })

  it('weights required views above recommended ones', () => {
    const requiredOnly = evaluateCoverage('electronics', [
      { view: 'front' },
      { view: 'back' },
      { view: 'label' },
      { view: 'serial' },
    ])
    const recommendedOnly = evaluateCoverage('electronics', [
      { view: 'damage' },
      { view: 'accessories' },
    ])
    expect(requiredOnly.completeness).toBeGreaterThan(recommendedOnly.completeness)
  })

  it('reaches full completeness and stops asking once everything is captured', () => {
    const views = requirementsFor('tools').map((r) => ({ view: r.view }))
    const result = evaluateCoverage('tools', views)
    expect(result.completeness).toBe(1)
    expect(result.next).toBeNull()
  })

  it('ignores photos of views the category never asked for', () => {
    const result = evaluateCoverage('books_media', [{ view: 'front' }, { view: 'serial' }])
    expect(result.captured).toContain('serial')
    expect(result.isListable).toBe(true)
  })
})
