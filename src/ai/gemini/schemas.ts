import { Type, type Schema } from '@google/genai'
import { z } from 'zod'
import { itemCategories } from '@/domain/types'

/* -------------------------------------------------------------------------- */
/* Object detection                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The schema handed to Gemini. Structured output makes the model emit valid
 * JSON of this shape; the Zod schema below still re-validates it, because
 * "valid JSON of the right shape" and "values we can trust" are different
 * claims — a box of `[0,0,0,0]` satisfies both the type and nothing else.
 */
export const detectionResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    objects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: {
            type: Type.STRING,
            description:
              'Short human name for the object as a seller would say it, e.g. "office chair", "cordless drill". Include a brand only if it is legible in the image.',
          },
          category: {
            type: Type.STRING,
            enum: [...itemCategories],
          },
          box_2d: {
            type: Type.ARRAY,
            description: 'Bounding box as [ymin, xmin, ymax, xmax], scaled 0-1000.',
            items: { type: Type.INTEGER },
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence between 0 and 1 that this is a distinct, real object.',
          },
          sellable: {
            type: Type.BOOLEAN,
            description:
              'True if this is a discrete item someone could list for sale. False for structure (walls, floor, ceiling, doors) and for fixtures that are not being sold.',
          },
        },
        required: ['label', 'category', 'box_2d', 'confidence', 'sellable'],
      },
    },
  },
  required: ['objects'],
}

export const geminiDetectionSchema = z.object({
  objects: z
    .array(
      z.object({
        label: z.string().min(1),
        category: z.string().optional(),
        box_2d: z.array(z.number()).length(4),
        confidence: z.number().optional(),
        sellable: z.boolean().optional(),
        mask: z.string().optional(),
      }),
    )
    .default([]),
})

export type GeminiDetectionResponse = z.infer<typeof geminiDetectionSchema>

/* -------------------------------------------------------------------------- */
/* Photo quality                                                              */
/* -------------------------------------------------------------------------- */

export const qualityResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    blurScore: {
      type: Type.NUMBER,
      description: '0 = severely blurred, 1 = tack sharp.',
    },
    exposure: {
      type: Type.NUMBER,
      description: '0 = black, 0.5 = well exposed, 1 = blown out.',
    },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        enum: ['blurry', 'too_dark', 'too_bright', 'low_resolution', 'obstructed', 'too_far'],
      },
    },
    suggestion: {
      type: Type.STRING,
      description:
        'One short imperative instruction to improve the photo, e.g. "Move closer and fill the frame". Empty string if the photo is good.',
    },
  },
  required: ['blurScore', 'exposure', 'issues', 'suggestion'],
}

export const geminiQualitySchema = z.object({
  blurScore: z.number(),
  exposure: z.number(),
  issues: z.array(
    z.enum(['blurry', 'too_dark', 'too_bright', 'low_resolution', 'obstructed', 'too_far']),
  ),
  suggestion: z.string(),
})
