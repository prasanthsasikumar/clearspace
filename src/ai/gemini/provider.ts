import { boxFromGemini, suppressOverlapping } from '@/domain/geometry'
import { isItemCategory, type DetectedObject } from '@/domain/types'
import {
  NotImplementedYetError,
  VisionProviderError,
  type AssessQualityInput,
  type AssessQualityResult,
  type DetectObjectsInput,
  type GenerateListingInput,
  type IdentifyItemInput,
  type ListingDraft,
  type ResearchValueInput,
  type ValuationResult,
  type IdentificationResult,
  type VisionProvider,
} from '../vision-provider'
import { GeminiClient, type GeminiClientOptions } from './client'
import { buildDetectionPrompt, buildQualityPrompt } from './prompts'
import {
  detectionResponseSchema,
  geminiDetectionSchema,
  geminiQualitySchema,
  qualityResponseSchema,
} from './schemas'

const PROVIDER_NAME = 'gemini'
const DEFAULT_MAX_OBJECTS = 25

export class GeminiVisionProvider implements VisionProvider {
  readonly name = PROVIDER_NAME

  private readonly client: GeminiClient

  constructor(options: GeminiClientOptions | { client: GeminiClient }) {
    this.client = 'client' in options ? options.client : new GeminiClient(options)
  }

  async detectObjects(input: DetectObjectsInput): Promise<DetectedObject[]> {
    const maxObjects = input.maxObjects ?? DEFAULT_MAX_OBJECTS
    const prompt = buildDetectionPrompt({
      lotKind: input.context?.lotKind,
      hint: input.context?.hint,
      maxObjects,
    })

    const raw = await this.client.generateJson(
      [GeminiClient.imagePart(input.image), GeminiClient.textPart(prompt)],
      detectionResponseSchema,
      PROVIDER_NAME,
    )

    const parsed = geminiDetectionSchema.safeParse(raw)
    if (!parsed.success) {
      throw new VisionProviderError(
        `Detection response did not match the expected shape: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        PROVIDER_NAME,
        parsed.error,
      )
    }

    const detections: DetectedObject[] = []
    for (const object of parsed.data.objects) {
      if (object.sellable === false) continue

      // A box the model mangled is dropped rather than surfaced as a zero-size
      // rectangle the user cannot tap.
      const bbox = boxFromGemini(object.box_2d)
      if (!bbox) continue

      detections.push({
        label: object.label.trim(),
        category:
          object.category && isItemCategory(object.category) ? object.category : null,
        bbox,
        confidence: clampConfidence(object.confidence),
        maskPngBase64: object.mask ?? null,
      })
    }

    return suppressOverlapping(detections).slice(0, maxObjects)
  }

  async assessPhotoQuality(input: AssessQualityInput): Promise<AssessQualityResult> {
    const prompt = buildQualityPrompt({
      intendedView: input.intendedView,
      itemTitle: input.itemTitle,
    })

    const raw = await this.client.generateJson(
      [GeminiClient.imagePart(input.image), GeminiClient.textPart(prompt)],
      qualityResponseSchema,
      PROVIDER_NAME,
    )

    const parsed = geminiQualitySchema.safeParse(raw)
    if (!parsed.success) {
      throw new VisionProviderError(
        'Quality response did not match the expected shape',
        PROVIDER_NAME,
        parsed.error,
      )
    }

    const suggestion = parsed.data.suggestion.trim()
    return {
      blurScore: clamp01(parsed.data.blurScore),
      exposure: clamp01(parsed.data.exposure),
      issues: parsed.data.issues,
      suggestion: suggestion.length > 0 ? suggestion : null,
    }
  }

  /* --- Stage B ------------------------------------------------------------- */

  async identifyItem(_input: IdentifyItemInput): Promise<IdentificationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'identifyItem')
  }

  async researchValue(_input: ResearchValueInput): Promise<ValuationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'researchValue')
  }

  async generateListing(_input: GenerateListingInput): Promise<ListingDraft> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'generateListing')
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function clampConfidence(value: number | undefined): number | null {
  return value === undefined ? null : clamp01(value)
}

export { isRetryable, stripCodeFence } from './client'
