import { describe, expect, it } from 'vitest'
import { defaultDetections } from '@/ai/fixture-provider'
import { geminiDetectionSchema } from '@/ai/gemini/schemas'
import { isRetryable, stripCodeFence } from '@/ai/gemini/provider'
import { VisionProviderError } from '@/ai/vision-provider'
import { buildDetectionPrompt } from '@/ai/gemini/prompts'
import { isValidBox } from '@/domain/geometry'

describe('geminiDetectionSchema', () => {
  it('accepts a well-formed response', () => {
    const parsed = geminiDetectionSchema.parse({
      objects: [
        { label: 'chair', category: 'furniture', box_2d: [1, 2, 3, 4], confidence: 0.9 },
      ],
    })
    expect(parsed.objects).toHaveLength(1)
  })

  it('defaults an absent objects array rather than throwing', () => {
    expect(geminiDetectionSchema.parse({}).objects).toEqual([])
  })

  it('rejects a box that is not four numbers', () => {
    expect(() =>
      geminiDetectionSchema.parse({ objects: [{ label: 'chair', box_2d: [1, 2, 3] }] }),
    ).toThrow()
  })

  it('rejects an object with no label', () => {
    expect(() =>
      geminiDetectionSchema.parse({ objects: [{ label: '', box_2d: [1, 2, 3, 4] }] }),
    ).toThrow()
  })
})

describe('the recorded fixture', () => {
  const detections = defaultDetections()

  it('parses through the same schema and conversion the live provider uses', () => {
    expect(detections.length).toBeGreaterThan(0)
    for (const detection of detections) {
      expect(isValidBox(detection.bbox)).toBe(true)
      expect(detection.label.length).toBeGreaterThan(0)
    }
  })

  it('drops the objects marked unsellable', () => {
    // The fixture includes a `concrete floor` box flagged sellable: false.
    // A `floor lamp` is in there too, and must survive.
    expect(detections.some((d) => d.label === 'concrete floor')).toBe(false)
    expect(detections.some((d) => d.label === 'floor lamp')).toBe(true)
  })

  it('maps categories that exist in the taxonomy and nulls the rest', () => {
    const chair = detections.find((d) => d.label.includes('chair'))
    expect(chair?.category).toBe('furniture')
  })

  it('is stable across calls, so demo mode is deterministic', () => {
    expect(defaultDetections()).toBe(detections)
  })
})

describe('stripCodeFence', () => {
  it('leaves bare JSON alone', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })

  it('unwraps a fenced block the model added anyway', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
})

describe('isRetryable', () => {
  it('retries rate limits and server errors', () => {
    expect(isRetryable({ status: 429 })).toBe(true)
    expect(isRetryable({ status: 503 })).toBe(true)
    expect(isRetryable(new Error('model is overloaded'))).toBe(true)
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true)
  })

  it('does not retry a client error or a bad request', () => {
    expect(isRetryable({ status: 400 })).toBe(false)
    expect(isRetryable({ status: 401 })).toBe(false)
  })

  it('never retries a schema mismatch — resending cannot fix it', () => {
    expect(isRetryable(new VisionProviderError('bad shape', 'gemini'))).toBe(false)
  })
})

describe('buildDetectionPrompt', () => {
  it('carries the rules that keep the review screen usable', () => {
    const prompt = buildDetectionPrompt({ lotKind: 'storage_unit', maxObjects: 20 })
    expect(prompt).toMatch(/whole objects, not their parts/i)
    expect(prompt).toMatch(/walls, floors, ceilings/i)
    expect(prompt).toMatch(/single lot/i)
    expect(prompt).toMatch(/at most 20 objects/i)
    expect(prompt).toMatch(/storage unit/i)
  })

  it('forbids inventing brands that are not legible', () => {
    expect(buildDetectionPrompt({ maxObjects: 10 })).toMatch(/not guess brands/i)
  })

  it('passes the seller’s own note through to the model', () => {
    const prompt = buildDetectionPrompt({ maxObjects: 10, hint: 'mostly camera gear' })
    expect(prompt).toContain('mostly camera gear')
  })
})
