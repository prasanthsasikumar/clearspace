import { GoogleGenAI, type Schema } from '@google/genai'
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
import { buildDetectionPrompt, buildQualityPrompt } from './prompts'
import {
  detectionResponseSchema,
  geminiDetectionSchema,
  geminiQualitySchema,
  qualityResponseSchema,
} from './schemas'

const PROVIDER_NAME = 'gemini'
const DEFAULT_MAX_OBJECTS = 25

export interface GeminiProviderOptions {
  apiKey: string
  model?: string
  maxRetries?: number
  /** Injectable for tests; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class GeminiVisionProvider implements VisionProvider {
  readonly name = PROVIDER_NAME

  private readonly client: GoogleGenAI
  private readonly model: string
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey })
    this.model = options.model ?? 'gemini-2.5-flash'
    this.maxRetries = options.maxRetries ?? 2
    this.sleep = options.sleep ?? defaultSleep
  }

  async detectObjects(input: DetectObjectsInput): Promise<DetectedObject[]> {
    const maxObjects = input.maxObjects ?? DEFAULT_MAX_OBJECTS
    const prompt = buildDetectionPrompt({
      lotKind: input.context?.lotKind,
      hint: input.context?.hint,
      maxObjects,
    })

    const raw = await this.generateJson(prompt, input.image, detectionResponseSchema)
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

    const raw = await this.generateJson(prompt, input.image, qualityResponseSchema)
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

  /* --- Later phases -------------------------------------------------------- */

  async identifyItem(_input: IdentifyItemInput): Promise<IdentificationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'identifyItem')
  }

  async researchValue(_input: ResearchValueInput): Promise<ValuationResult> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'researchValue')
  }

  async generateListing(_input: GenerateListingInput): Promise<ListingDraft> {
    throw new NotImplementedYetError(PROVIDER_NAME, 'generateListing')
  }

  /* --- Transport ----------------------------------------------------------- */

  private async generateJson(
    prompt: string,
    image: { data: Buffer; mimeType: string },
    responseSchema: Schema,
  ): Promise<unknown> {
    const text = await this.withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data.toString('base64'),
                },
              },
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          // Cataloguing is not a creative task; determinism makes re-scanning
          // the same photo produce a stable inventory.
          temperature: 0,
        },
      })

      const body = response.text
      if (!body) {
        throw new VisionProviderError('Gemini returned an empty response', PROVIDER_NAME)
      }
      return body
    })

    try {
      return JSON.parse(stripCodeFence(text))
    } catch (error) {
      throw new VisionProviderError(
        'Gemini returned malformed JSON',
        PROVIDER_NAME,
        error,
      )
    }
  }

  /**
   * Retries transient transport failures only. A schema mismatch is a bug or a
   * prompt problem and re-sending the same request cannot fix it, so those
   * propagate immediately instead of burning quota.
   */
  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (!isRetryable(error) || attempt === this.maxRetries) break
        await this.sleep(1_000 * 2 ** attempt)
      }
    }

    throw new VisionProviderError(
      `Gemini request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      PROVIDER_NAME,
      lastError,
    )
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function clampConfidence(value: number | undefined): number | null {
  return value === undefined ? null : clamp01(value)
}

/**
 * Structured output normally returns bare JSON, but the model occasionally
 * wraps it in a markdown fence anyway. Cheaper to strip than to retry.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof VisionProviderError) return false

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : NaN

  if (Number.isFinite(status)) return status === 429 || status >= 500

  const message = error instanceof Error ? error.message : String(error)
  return /rate limit|429|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|unavailable|overloaded|internal error/i.test(
    message,
  )
}
