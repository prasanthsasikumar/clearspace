import { boxFromGemini, suppressOverlapping } from '@/domain/geometry'
import { isItemCategory, type DetectedObject } from '@/domain/types'
import storageLockerFixture from './fixtures/storage-locker.json'
import { geminiDetectionSchema } from './gemini/schemas'
import {
  NotImplementedYetError,
  type AssessQualityInput,
  type AssessQualityResult,
  type DetectObjectsInput,
  type GenerateListingInput,
  type IdentifyItemInput,
  type IdentificationResult,
  type ListingDraft,
  type ResearchValueInput,
  type ValuationResult,
  type VisionProvider,
} from './vision-provider'

const PROVIDER_NAME = 'fixture'

export interface FixtureResponses {
  detections?: DetectedObject[]
  quality?: AssessQualityResult
  /** Set to make every call reject, for exercising error paths. */
  error?: Error
}

/**
 * Replays recorded responses instead of calling a vendor.
 *
 * This backs two things that would otherwise be separate code paths: the whole
 * test suite runs without a network or an API key, and the app stays fully
 * explorable in demo mode when GEMINI_API_KEY is unset. Demo mode exercising
 * the same job queue, crop pipeline, and UI as production is the point — a
 * demo that shortcuts the real path proves nothing.
 */
export class FixtureVisionProvider implements VisionProvider {
  readonly name = PROVIDER_NAME

  constructor(private readonly responses: FixtureResponses = {}) {}

  async detectObjects(_input: DetectObjectsInput): Promise<DetectedObject[]> {
    this.throwIfConfigured()
    return this.responses.detections ?? defaultDetections()
  }

  async assessPhotoQuality(_input: AssessQualityInput): Promise<AssessQualityResult> {
    this.throwIfConfigured()
    return (
      this.responses.quality ?? {
        blurScore: 0.82,
        exposure: 0.54,
        issues: [],
        suggestion: null,
      }
    )
  }

  async identifyItem(_input: IdentifyItemInput): Promise<IdentificationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'identifyItem')
  }

  async researchValue(_input: ResearchValueInput): Promise<ValuationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'researchValue')
  }

  async generateListing(_input: GenerateListingInput): Promise<ListingDraft> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'generateListing')
  }

  private throwIfConfigured(): void {
    if (this.responses.error) throw this.responses.error
  }
}

let cached: DetectedObject[] | null = null

/**
 * Parses the recorded fixture through the exact same Zod schema and coordinate
 * conversion the live provider uses, so a change to either is caught by the
 * fixture-backed tests rather than only in production.
 */
export function defaultDetections(): DetectedObject[] {
  if (cached) return cached

  const parsed = geminiDetectionSchema.parse(storageLockerFixture)
  const detections: DetectedObject[] = []

  for (const object of parsed.objects) {
    if (object.sellable === false) continue
    const bbox = boxFromGemini(object.box_2d)
    if (!bbox) continue
    detections.push({
      label: object.label,
      category: object.category && isItemCategory(object.category) ? object.category : null,
      bbox,
      confidence: object.confidence ?? null,
      maskPngBase64: null,
    })
  }

  cached = suppressOverlapping(detections)
  return cached
}
