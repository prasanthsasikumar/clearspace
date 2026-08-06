import { describe, expect, it } from 'vitest'
import {
  boxArea,
  boxFromDrag,
  boxFromGemini,
  clampBox,
  iou,
  isValidBox,
  padBox,
  pickBoxAt,
  suppressOverlapping,
  toPixelRect,
  type BoundingBox,
} from '@/domain/geometry'

/** Boxes are floats; comparing them field-by-field keeps 0.1 + 0.2 out of it. */
function expectBox(actual: BoundingBox | null, expected: BoundingBox) {
  expect(actual).not.toBeNull()
  expect(actual!.x).toBeCloseTo(expected.x, 10)
  expect(actual!.y).toBeCloseTo(expected.y, 10)
  expect(actual!.w).toBeCloseTo(expected.w, 10)
  expect(actual!.h).toBeCloseTo(expected.h, 10)
}

describe('boxFromGemini', () => {
  it('converts [ymin, xmin, ymax, xmax] at 0-1000 into normalized x/y/w/h', () => {
    expectBox(boxFromGemini([100, 200, 500, 600]), { x: 0.2, y: 0.1, w: 0.4, h: 0.4 })
  })

  it('orders reversed pairs rather than discarding the detection', () => {
    expectBox(boxFromGemini([500, 600, 100, 200]), { x: 0.2, y: 0.1, w: 0.4, h: 0.4 })
  })

  it('clamps a box that runs past the image edge', () => {
    const box = boxFromGemini([0, 0, 1200, 1100])
    expect(box).not.toBeNull()
    expect(box!.x + box!.w).toBeLessThanOrEqual(1)
    expect(box!.y + box!.h).toBeLessThanOrEqual(1)
  })

  it('rejects degenerate and malformed boxes', () => {
    expect(boxFromGemini([100, 100, 100, 100])).toBeNull()
    expect(boxFromGemini([1, 2, 3])).toBeNull()
    expect(boxFromGemini([Number.NaN, 0, 100, 100])).toBeNull()
  })
})

describe('isValidBox', () => {
  it('accepts a box inside the unit square', () => {
    expect(isValidBox({ x: 0, y: 0, w: 1, h: 1 })).toBe(true)
  })

  it('rejects zero-size, negative-origin, and overflowing boxes', () => {
    expect(isValidBox({ x: 0.1, y: 0.1, w: 0, h: 0.2 })).toBe(false)
    expect(isValidBox({ x: -0.1, y: 0.1, w: 0.2, h: 0.2 })).toBe(false)
    expect(isValidBox({ x: 0.9, y: 0.1, w: 0.5, h: 0.2 })).toBe(false)
  })
})

describe('clampBox', () => {
  it('keeps the part of a box that is inside the image', () => {
    expectBox(clampBox({ x: -0.2, y: 0.5, w: 0.5, h: 0.8 }), {
      x: 0,
      y: 0.5,
      w: 0.3,
      h: 0.5,
    })
  })
})

describe('padBox', () => {
  it('grows the box by a fraction of its own size', () => {
    expectBox(padBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.5), {
      x: 0.3,
      y: 0.3,
      w: 0.4,
      h: 0.4,
    })
  })

  it('never pads past the image edge', () => {
    const padded = padBox({ x: 0, y: 0, w: 0.2, h: 0.2 }, 1)
    expect(padded.x).toBe(0)
    expect(padded.y).toBe(0)
  })
})

describe('toPixelRect', () => {
  it('produces integer pixels inside the image', () => {
    expect(toPixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 600)).toEqual({
      left: 200,
      top: 300,
      width: 400,
      height: 150,
    })
  })

  it('enforces a minimum size so extract is never handed a zero-width rect', () => {
    const rect = toPixelRect({ x: 0.5, y: 0.5, w: 0.0001, h: 0.0001 }, 800, 600, 16)
    expect(rect.width).toBe(16)
    expect(rect.height).toBe(16)
  })

  it('shifts a minimum-size rect inward rather than overflowing the edge', () => {
    const rect = toPixelRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, 800, 600, 16)
    expect(rect.left + rect.width).toBeLessThanOrEqual(800)
    expect(rect.top + rect.height).toBeLessThanOrEqual(600)
  })

  it('caps the minimum at the image size for tiny images', () => {
    const rect = toPixelRect({ x: 0, y: 0, w: 1, h: 1 }, 4, 4, 16)
    expect(rect).toEqual({ left: 0, top: 0, width: 4, height: 4 })
  })

  it('refuses impossible image dimensions', () => {
    expect(() => toPixelRect({ x: 0, y: 0, w: 1, h: 1 }, 0, 600)).toThrow()
  })
})

describe('iou', () => {
  it('is 1 for identical boxes and 0 for disjoint ones', () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    expect(iou(box, box)).toBeCloseTo(1)
    expect(iou(box, { x: 0.8, y: 0.8, w: 0.1, h: 0.1 })).toBe(0)
  })

  it('measures partial overlap', () => {
    const a = { x: 0, y: 0, w: 0.4, h: 0.4 }
    const b = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }
    // intersection 0.2*0.2 = 0.04; union 0.16 + 0.16 - 0.04 = 0.28
    expect(iou(a, b)).toBeCloseTo(0.04 / 0.28)
  })
})

describe('suppressOverlapping', () => {
  it('keeps the most confident of several boxes over the same object', () => {
    const kept = suppressOverlapping([
      { label: 'furniture', bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, confidence: 0.5 },
      { label: 'office chair', bbox: { x: 0.11, y: 0.11, w: 0.3, h: 0.3 }, confidence: 0.9 },
      { label: 'chair', bbox: { x: 0.1, y: 0.1, w: 0.29, h: 0.3 }, confidence: 0.7 },
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0]!.label).toBe('office chair')
  })

  it('leaves genuinely separate objects alone', () => {
    const kept = suppressOverlapping([
      { label: 'lamp', bbox: { x: 0.05, y: 0.05, w: 0.2, h: 0.2 }, confidence: 0.8 },
      { label: 'toolbox', bbox: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }, confidence: 0.8 },
    ])
    expect(kept).toHaveLength(2)
  })

  it('breaks confidence ties toward the larger box', () => {
    const kept = suppressOverlapping([
      { label: 'cushion', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, confidence: 0.8 },
      { label: 'sofa', bbox: { x: 0.1, y: 0.1, w: 0.22, h: 0.22 }, confidence: 0.8 },
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0]!.label).toBe('sofa')
  })
})

describe('boxFromDrag', () => {
  it('builds the same box regardless of drag direction', () => {
    const forward = boxFromDrag({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 })
    const backward = boxFromDrag({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.2 })
    expect(forward).toEqual(backward)
    expect(forward.w).toBeCloseTo(0.3)
    expect(forward.h).toBeCloseTo(0.4)
  })

  it('clamps a drag that left the image', () => {
    const box = boxFromDrag({ x: 0.5, y: 0.5 }, { x: 1.4, y: -0.3 })
    expect(box.x + box.w).toBeLessThanOrEqual(1)
    expect(box.y).toBe(0)
  })
})

describe('pickBoxAt', () => {
  const shelf = { id: 'shelf', bbox: { x: 0.1, y: 0.1, w: 0.6, h: 0.6 } }
  const toolbox = { id: 'toolbox', bbox: { x: 0.2, y: 0.2, w: 0.15, h: 0.15 } }

  it('resolves a tap inside nested boxes to the smallest one', () => {
    expect(pickBoxAt([shelf, toolbox], { x: 0.25, y: 0.25 })?.id).toBe('toolbox')
  })

  it('falls back to the enclosing box outside the nested one', () => {
    expect(pickBoxAt([shelf, toolbox], { x: 0.6, y: 0.6 })?.id).toBe('shelf')
  })

  it('returns null when the tap missed everything', () => {
    expect(pickBoxAt([shelf, toolbox], { x: 0.95, y: 0.95 })).toBeNull()
  })
})

describe('boxArea', () => {
  it('never reports a negative area', () => {
    expect(boxArea({ x: 0, y: 0, w: -1, h: 0.5 })).toBe(0)
  })
})
