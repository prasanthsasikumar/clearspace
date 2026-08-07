import { GoogleGenAI, type Part, type Schema } from '@google/genai'
import { VisionProviderError } from '../vision-provider'

export interface GeminiClientOptions {
  apiKey: string
  model?: string
  maxRetries?: number
  /** Injectable so retry tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * The transport every Gemini adapter shares: build parts, ask for structured
 * JSON, retry only what retrying can fix, and parse defensively.
 *
 * Kept separate from the adapters so the detection provider and the object
 * matcher cannot drift apart on retry policy or error handling — two copies of
 * this logic is exactly how one of them ends up silently retrying a schema
 * mismatch forever.
 */
export class GeminiClient {
  private readonly client: GoogleGenAI
  readonly model: string
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: GeminiClientOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey })
    this.model = options.model ?? 'gemini-2.5-flash'
    this.maxRetries = options.maxRetries ?? 2
    this.sleep = options.sleep ?? defaultSleep
  }

  static imagePart(image: { data: Buffer; mimeType: string }): Part {
    return { inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } }
  }

  static textPart(text: string): Part {
    return { text }
  }

  async generateJson(
    parts: readonly Part[],
    responseSchema: Schema,
    providerName: string,
  ): Promise<unknown> {
    const text = await this.withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [...parts] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema,
          // Cataloguing is not a creative task; determinism means re-running a
          // scan produces the same inventory rather than a different one.
          temperature: 0,
        },
      })

      const body = response.text
      if (!body) throw new VisionProviderError('Gemini returned an empty response', providerName)
      return body
    }, providerName)

    try {
      return JSON.parse(stripCodeFence(text))
    } catch (error) {
      throw new VisionProviderError('Gemini returned malformed JSON', providerName, error)
    }
  }

  /**
   * A grounded call: search on, no response schema.
   *
   * The two are mutually exclusive in practice — supplying a schema makes the
   * model stop searching without saying so — so this returns prose plus the
   * pages it actually retrieved, and a second structuring call turns that into
   * data. See `gemini/enrichment.ts` for the measurement behind this.
   */
  async generateGrounded(
    parts: readonly Part[],
    providerName: string,
  ): Promise<{ text: string; sources: Array<{ title: string; url: string }>; queries: string[] }> {
    const { extractSources } = await import('./enrichment')

    return this.withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [...parts] }],
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
        },
      })

      const text = response.text
      if (!text) {
        throw new VisionProviderError('Gemini returned an empty response', providerName)
      }

      const { sources, queries } = extractSources(response.candidates?.[0])
      return { text, sources, queries }
    }, providerName)
  }

  /**
   * Retries transport failures only. A schema mismatch is a bug or a prompt
   * problem, and re-sending an identical request cannot fix it — those
   * propagate immediately instead of burning quota three times over.
   */
  private async withRetry<T>(operation: () => Promise<T>, providerName: string): Promise<T> {
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
      providerName,
      lastError,
    )
  }
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
