import type { DetectedObject, PhotoQuality } from '@/domain/types'

export interface ImageInput {
  data: Buffer
  mimeType: string
}

export interface DetectObjectsInput {
  image: ImageInput
  /**
   * What the user said they were scanning. A storage locker and a jewellery
   * case want very different granularity, and telling the model which it is
   * measurably reduces both misses and over-segmentation.
   */
  context?: {
    lotKind?: string
    hint?: string
  }
  /** Upper bound on returned objects; keeps the review screen usable. */
  maxObjects?: number
}

export interface AssessQualityInput {
  image: ImageInput
  /** The view this photo was meant to capture, e.g. `label` or `damage`. */
  intendedView?: string
  itemTitle?: string
}

export interface AssessQualityResult extends PhotoQuality {
  /** One short, actionable instruction, or null when the photo is fine. */
  suggestion: string | null
}

/* --- Phase 2 / 3 shapes ---------------------------------------------------- */

export interface IdentifyItemInput {
  images: ImageInput[]
  userNotes?: string
  knownBrand?: string
  knownModel?: string
}

export interface IdentificationResult {
  productName: string | null
  manufacturer: string | null
  model: string | null
  category: string | null
  msrpCents: number | null
  confidence: number
  sources: Array<{ title: string; url: string }>
}

export interface ResearchValueInput {
  productName: string
  condition: string
  images?: ImageInput[]
}

export interface ValuationResult {
  lowCents: number
  highCents: number
  recommendedCents: number
  comparables: Array<{ title: string; priceCents: number; url: string; soldAt?: string }>
  method: string
}

export interface GenerateListingInput {
  title: string
  category: string | null
  brand: string | null
  model: string | null
  condition: string | null
  conditionNotes: string | null
  userNotes: string | null
  dimensions: string | null
  marketplace: string
  priceCents: number | null
}

export interface ListingDraft {
  title: string
  description: string
  categoryPath: string
  conditionLabel: string
}

/**
 * The one seam between Sorta and any vision vendor.
 *
 * Gemini implements it today. A future GroundingDINO + SAM 2 pipeline would
 * implement `detectObjects` alone and compose with Gemini for the reasoning
 * methods — which is exactly why detection is its own method rather than a
 * flag on a general-purpose `analyze` call.
 */
export interface VisionProvider {
  readonly name: string
  detectObjects(input: DetectObjectsInput): Promise<DetectedObject[]>
  assessPhotoQuality(input: AssessQualityInput): Promise<AssessQualityResult>
  identifyItem(input: IdentifyItemInput): Promise<IdentificationResult>
  researchValue(input: ResearchValueInput): Promise<ValuationResult>
  generateListing(input: GenerateListingInput): Promise<ListingDraft>
}

/** Thrown when a provider is reachable but its response cannot be trusted. */
export class VisionProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'VisionProviderError'
  }
}

/** Phase 2/3 methods throw this until their phase lands. */
export class NotImplementedYetError extends VisionProviderError {
  constructor(provider: string, method: string) {
    super(`${provider}.${method}() arrives in a later phase`, provider)
    this.name = 'NotImplementedYetError'
  }
}
