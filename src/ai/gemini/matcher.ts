import { Type, type Schema } from '@google/genai'
import { z } from 'zod'
import {
  noMatches,
  type MatchObjectsInput,
  type ObjectMatcher,
} from '../object-matcher'
import { VisionProviderError } from '../vision-provider'
import { GeminiClient, type GeminiClientOptions } from './client'

const MATCHER_NAME = 'gemini-matcher'

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    groups: {
      type: Type.ARRAY,
      description: 'One entry per distinct physical object.',
      items: {
        type: Type.OBJECT,
        properties: {
          image_numbers: {
            type: Type.ARRAY,
            description: 'The numbered images showing this one object.',
            items: { type: Type.INTEGER },
          },
        },
        required: ['image_numbers'],
      },
    },
  },
  required: ['groups'],
}

export const matcherResponseSchema = z.object({
  groups: z.array(z.object({ image_numbers: z.array(z.number()) })).default([]),
})

/**
 * The prompt is written to fail toward *separate*.
 *
 * A storage unit is full of things that look alike: four matching dining
 * chairs, three identical storage bins, two of the same drill. Left to its own
 * instincts a vision model happily merges them, and each merge silently
 * destroys inventory the user photographed. A duplicate listing is annoying and
 * visible; a swallowed item is invisible. So the instruction is explicit that
 * matching *models* are not the same object, and that uncertainty means keep
 * them apart.
 */
export function buildMatcherPrompt(count: number, categoryHint?: string): string {
  return [
    `You are shown ${count} numbered images. Each is one object cut out of a photograph of a space someone is clearing out.`,
    categoryHint ? `They have all been classified as: ${categoryHint}.` : undefined,
    '',
    'Several photographs were taken of the same space, so one object may appear more than once.',
    'Group the images that show THE SAME PHYSICAL OBJECT photographed on different occasions or from different angles.',
    '',
    'Rules:',
    '- Two objects of the same make and model are NOT the same object. Four matching dining chairs are four objects, not one.',
    '- Group two images only when the specific wear, marks, contents, surroundings, or position convince you it is literally the same thing.',
    '- If you are unsure, keep them separate. Separating one object into two is a small error; merging two objects into one destroys a record of something the seller owns.',
    '- An object appearing only once is a group containing just its number.',
    '- Every number from 1 to ' + count + ' must appear in exactly one group.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

/**
 * Matches crops with a single Gemini call per bucket.
 *
 * Images are referred to by position rather than by id: uuids cost tokens the
 * comparison does not benefit from, and models transcribe them wrong. The
 * mapping back to ids happens here, where an out-of-range number is simply
 * discarded.
 */
export class GeminiObjectMatcher implements ObjectMatcher {
  readonly name = MATCHER_NAME

  private readonly client: GeminiClient

  constructor(options: GeminiClientOptions | { client: GeminiClient }) {
    this.client = 'client' in options ? options.client : new GeminiClient(options)
  }

  async matchObjects(input: MatchObjectsInput): Promise<string[][]> {
    const candidates = input.candidates
    // Nothing to compare, and no reason to spend a call finding that out.
    if (candidates.length < 2) return noMatches(candidates)

    const parts = candidates.flatMap((candidate, index) => [
      GeminiClient.textPart(`Image ${index + 1}: ${candidate.label}`),
      GeminiClient.imagePart(candidate.image),
    ])
    parts.push(GeminiClient.textPart(buildMatcherPrompt(candidates.length, input.categoryHint)))

    const raw = await this.client.generateJson(parts, responseSchema, MATCHER_NAME)
    const parsed = matcherResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new VisionProviderError(
        'Matcher response did not match the expected shape',
        MATCHER_NAME,
        parsed.error,
      )
    }

    return toIdGroups(parsed.data.groups, candidates)
  }
}

/**
 * Maps 1-based image numbers back to candidate ids, dropping anything out of
 * range. Ids the model omitted are not added back here; `applyGrouping` owns
 * that repair, so there is one place responsible for never losing a detection.
 */
export function toIdGroups(
  groups: readonly { image_numbers: number[] }[],
  candidates: readonly { id: string }[],
): string[][] {
  const result: string[][] = []

  for (const group of groups) {
    const ids: string[] = []
    for (const number of group.image_numbers) {
      const candidate = candidates[Math.trunc(number) - 1]
      if (candidate) ids.push(candidate.id)
    }
    if (ids.length > 0) result.push(ids)
  }

  return result
}
