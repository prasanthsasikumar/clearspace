import { z } from 'zod'
import { itemCategorySchema, dimensionsSchema } from '@/domain/types'
import { isValidBox } from '@/domain/geometry'

export const lotKindSchema = z.enum([
  'storage_unit',
  'garage',
  'home',
  'estate',
  'office',
  'other',
])

export const itemConditionSchema = z.enum([
  'new',
  'like_new',
  'excellent',
  'good',
  'fair',
  'poor',
  'for_parts',
])

export const itemStatusSchema = z.enum([
  'detected',
  'photos_needed',
  'ai_identified',
  'needs_confirmation',
  'confirmed',
  'listed',
  'sold',
  'discarded',
])

export const photoViewSchema = z.enum([
  'front',
  'side',
  'back',
  'top',
  'label',
  'damage',
  'serial',
  'accessories',
  'other',
])

/** Boxes arrive from a browser, so they are validated, not trusted. */
export const boundingBoxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .refine(isValidBox, {
    message: 'Box must be normalized to 0-1 and have a non-zero size.',
  })

export const createLotSchema = z.object({
  name: z.string().trim().min(1, 'Give this lot a name.').max(120),
  kind: lotKindSchema.default('other'),
  locationText: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
})

export const updateLotSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  kind: lotKindSchema.optional(),
  locationText: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  archived: z.boolean().optional(),
})

export const createItemSchema = z.object({
  title: z.string().trim().min(1, 'Give this item a title.').max(200),
  category: itemCategorySchema.nullish(),
  brand: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  condition: itemConditionSchema.nullish(),
  userNotes: z.string().trim().max(4000).nullish(),
})

export const updateItemSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: itemCategorySchema.nullish(),
  brand: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(120).nullish(),
  condition: itemConditionSchema.nullish(),
  conditionNotes: z.string().trim().max(2000).nullish(),
  dimensions: dimensionsSchema.nullish(),
  serialNumber: z.string().trim().max(120).nullish(),
  userNotes: z.string().trim().max(4000).nullish(),
  status: itemStatusSchema.optional(),
  estimatedValueCents: z.number().int().min(0).max(100_000_000).nullish(),
  // Set false when a person has actually looked at the suggested price.
  priceUnconfirmed: z.boolean().optional(),
})

export const updateDetectionSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  category: itemCategorySchema.nullish(),
  bbox: boundingBoxSchema.optional(),
})

export const createDetectionSchema = z.object({
  label: z.string().trim().min(1, 'Name what you drew a box around.').max(200),
  category: itemCategorySchema.nullish(),
  bbox: boundingBoxSchema,
  frameId: z.string().uuid().optional(),
})

export const photoQualityInputSchema = z.object({
  blurScore: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  issues: z.array(
    z.enum(['blurry', 'too_dark', 'too_bright', 'low_resolution', 'obstructed', 'too_far']),
  ),
})

export const scanKindSchema = z.enum(['scene', 'photo'])
