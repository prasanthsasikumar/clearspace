import { Type, type Part, type Schema } from '@google/genai'
import { z } from 'zod'
import { itemCategories } from '@/domain/types'
import { VisionProviderError } from '../vision-provider'
import { GeminiClient, type GeminiClientOptions } from './client'

const NAME = 'gemini-enrichment'

/* -------------------------------------------------------------------------- */
/* Why this takes two calls                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Gemini will accept `googleSearch` and `responseSchema` in the same request,
 * and then silently not search. Measured against a real key: the response comes
 * back as flawless JSON with zero grounding chunks and zero web queries. The
 * price in it is invented, and nothing in the reply says so.
 *
 * That is the single worst failure this app could ship: a fabricated number
 * wearing the costume of a researched one. So enrichment is two calls.
 *
 *   1. RESEARCH: search on, no schema. Actually queries the web and returns
 *      prose plus `groundingMetadata` carrying the URLs it read.
 *   2. STRUCTURE: schema on, no search. Turns that prose into the listing,
 *      and is explicitly told to use only what the research found.
 *
 * The sources attached to a valuation are therefore pages that were genuinely
 * retrieved, not citations the model composed after the fact.
 */

export interface EnrichmentInput {
  images: readonly { data: Buffer; mimeType: string }[]
  title: string
  category: string | null
  userNotes: string | null
  condition: string | null
  currency: string
}

export interface EnrichmentSource {
  title: string
  url: string
}

export interface EnrichmentResult {
  productName: string | null
  manufacturer: string | null
  model: string | null
  category: string | null
  condition: string
  conditionNotes: string | null
  title: string
  description: string
  lowCents: number
  highCents: number
  recommendedCents: number
  /** How the price was arrived at, in one sentence, for display. */
  priceBasis: string
  confidence: number
  sources: EnrichmentSource[]
  searchQueries: string[]
  /** True when the research call came back with no sources at all. */
  unsourced: boolean
}

const structuredSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    productName: { type: Type.STRING, description: 'Specific product name, or empty if unsure.' },
    manufacturer: { type: Type.STRING },
    model: { type: Type.STRING },
    category: { type: Type.STRING, enum: [...itemCategories] },
    condition: {
      type: Type.STRING,
      enum: ['new', 'like_new', 'excellent', 'good', 'fair', 'poor', 'for_parts'],
    },
    conditionNotes: {
      type: Type.STRING,
      description: 'Visible wear or damage, stated plainly. Empty if none is visible.',
    },
    title: { type: Type.STRING, description: 'Marketplace listing title, under 80 characters.' },
    description: {
      type: Type.STRING,
      description: 'Listing body. Two or three short paragraphs, plain sentences, no hype.',
    },
    lowCents: { type: Type.INTEGER },
    highCents: { type: Type.INTEGER },
    recommendedCents: { type: Type.INTEGER },
    priceBasis: {
      type: Type.STRING,
      description: 'One sentence naming what the price is based on.',
    },
    confidence: { type: Type.NUMBER, description: '0-1 confidence in the identification.' },
  },
  required: [
    'title',
    'description',
    'condition',
    'lowCents',
    'highCents',
    'recommendedCents',
    'priceBasis',
    'confidence',
  ],
}

const structuredParse = z.object({
  productName: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  category: z.string().optional(),
  condition: z.enum(['new', 'like_new', 'excellent', 'good', 'fair', 'poor', 'for_parts']),
  conditionNotes: z.string().optional(),
  title: z.string().min(1),
  description: z.string().min(1),
  lowCents: z.number(),
  highCents: z.number(),
  recommendedCents: z.number(),
  priceBasis: z.string(),
  confidence: z.number(),
})

export function buildResearchPrompt(input: EnrichmentInput): string {
  return [
    'Someone is selling this second-hand item and needs to know what it is and what it is worth.',
    `They have called it: "${input.title}".`,
    input.category ? `Category: ${input.category}.` : undefined,
    input.userNotes ? `They said: "${input.userNotes}"` : undefined,
    '',
    'Do two things:',
    '1. Identify the item as precisely as the photographs allow. Give the brand and model ONLY if you can actually read or recognise them; say "unknown" otherwise. A wrong model number on a listing becomes a dispute.',
    '2. Search the web for what this actually sells for used, and report the range you found with the prices you saw.',
    '',
    'Then state, in plain sentences:',
    '- what the item is',
    '- its visible condition and any damage you can see',
    `- a realistic used price range in ${input.currency}, and what that range is based on`,
    '',
    'If you could not find real prices, say so plainly instead of guessing.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

export function buildStructurePrompt(input: EnrichmentInput, research: string): string {
  return [
    'Here is research about a second-hand item someone is selling:',
    '',
    research,
    '',
    'Turn that into a marketplace listing.',
    '',
    'Rules:',
    '- Use only what the research above established. Do not introduce a brand, model, or price it did not support.',
    '- The description is written by the seller, in plain first-person sentences. No marketing adjectives, no "must-see", no exclamation marks.',
    '- State visible flaws in the description. Undisclosed damage is what causes returns.',
    `- Prices are integers in ${input.currency} cents.`,
    '- The title should read like something a person typed, not a catalogue entry.',
  ].join('\n')
}

/** Extracts the pages the research call genuinely retrieved. */
export function extractSources(candidate: unknown): {
  sources: EnrichmentSource[]
  queries: string[]
} {
  const meta = (candidate as { groundingMetadata?: unknown })?.groundingMetadata as
    | {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
        webSearchQueries?: string[]
      }
    | undefined

  const seen = new Set<string>()
  const sources: EnrichmentSource[] = []
  for (const chunk of meta?.groundingChunks ?? []) {
    const url = chunk.web?.uri
    if (!url || seen.has(url)) continue
    seen.add(url)
    sources.push({ title: chunk.web?.title ?? url, url })
  }

  return { sources, queries: meta?.webSearchQueries ?? [] }
}

export class GeminiEnricher {
  readonly name = NAME

  private readonly client: GeminiClient

  constructor(options: GeminiClientOptions | { client: GeminiClient }) {
    this.client = 'client' in options ? options.client : new GeminiClient(options)
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    // Capped at three images: more views help identification a little and cost
    // tokens a lot, and the first three are the best ones by construction.
    const imageParts: Part[] = input.images.slice(0, 3).map((i) => GeminiClient.imagePart(i))

    const research = await this.client.generateGrounded(
      [...imageParts, GeminiClient.textPart(buildResearchPrompt(input))],
      NAME,
    )

    const raw = await this.client.generateJson(
      [...imageParts, GeminiClient.textPart(buildStructurePrompt(input, research.text))],
      structuredSchema,
      NAME,
    )

    const parsed = structuredParse.safeParse(raw)
    if (!parsed.success) {
      throw new VisionProviderError(
        `Listing response did not match the expected shape: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        NAME,
        parsed.error,
      )
    }

    const data = parsed.data
    const low = Math.max(0, Math.round(data.lowCents))
    const high = Math.max(low, Math.round(data.highCents))
    const recommended = Math.min(Math.max(Math.round(data.recommendedCents), low), high)

    return {
      productName: blankToNull(data.productName),
      manufacturer: blankToNull(data.manufacturer),
      model: blankToNull(data.model),
      category: blankToNull(data.category),
      condition: data.condition,
      conditionNotes: blankToNull(data.conditionNotes),
      title: data.title.trim(),
      description: data.description.trim(),
      lowCents: low,
      highCents: high,
      recommendedCents: recommended,
      priceBasis: data.priceBasis.trim(),
      confidence: Math.min(Math.max(data.confidence, 0), 1),
      sources: research.sources,
      searchQueries: research.queries,
      unsourced: research.sources.length === 0,
    }
  }
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null
  return trimmed
}
