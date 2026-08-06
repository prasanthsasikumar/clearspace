import { z } from 'zod'

/* -------------------------------------------------------------------------- */
/* Dimensions                                                                 */
/* -------------------------------------------------------------------------- */

export const dimensionsSchema = z.object({
  w: z.number().positive(),
  h: z.number().positive(),
  d: z.number().positive().optional(),
  unit: z.enum(['in', 'cm']),
  /** `estimated` means a model guessed it; buyers deserve to know which. */
  source: z.enum(['estimated', 'user']),
})

export type Dimensions = z.infer<typeof dimensionsSchema>

/* -------------------------------------------------------------------------- */
/* Photo quality                                                              */
/* -------------------------------------------------------------------------- */

export const photoIssueSchema = z.enum([
  'blurry',
  'too_dark',
  'too_bright',
  'low_resolution',
  'obstructed',
  'too_far',
])

export type PhotoIssue = z.infer<typeof photoIssueSchema>

export const photoQualitySchema = z.object({
  /** Laplacian variance, normalized 0-1. Higher is sharper. */
  blurScore: z.number().min(0).max(1),
  /** Mean luminance, 0-1. Roughly 0.35-0.75 is a usable exposure. */
  exposure: z.number().min(0).max(1),
  issues: z.array(photoIssueSchema),
})

export type PhotoQuality = z.infer<typeof photoQualitySchema>

/* -------------------------------------------------------------------------- */
/* Detection                                                                  */
/* -------------------------------------------------------------------------- */

export const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
})

/** A detection as it exists before being written to the database. */
export interface DetectedObject {
  label: string
  category: string | null
  bbox: { x: number; y: number; w: number; h: number }
  confidence: number | null
  /** Base64 PNG mask covering the box region, if the provider produced one. */
  maskPngBase64?: string | null
}

/* -------------------------------------------------------------------------- */
/* Item category taxonomy                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A deliberately shallow taxonomy. It exists to drive two things: which photo
 * views an item needs, and which marketplace category it maps to. Anything
 * finer belongs in the free-text `category` field, not in code.
 */
export const itemCategories = [
  'furniture',
  'electronics',
  'appliance',
  'tools',
  'sporting_goods',
  'apparel',
  'jewelry',
  'collectibles',
  'books_media',
  'kitchenware',
  'toys',
  'auto_parts',
  'garden_outdoor',
  'musical_instruments',
  'other',
] as const

export type ItemCategory = (typeof itemCategories)[number]

export const itemCategorySchema = z.enum(itemCategories)

export function isItemCategory(value: string): value is ItemCategory {
  return (itemCategories as readonly string[]).includes(value)
}

export const categoryLabels: Record<ItemCategory, string> = {
  furniture: 'Furniture',
  electronics: 'Electronics',
  appliance: 'Appliances',
  tools: 'Tools',
  sporting_goods: 'Sporting Goods',
  apparel: 'Apparel',
  jewelry: 'Jewelry',
  collectibles: 'Collectibles',
  books_media: 'Books & Media',
  kitchenware: 'Kitchenware',
  toys: 'Toys',
  auto_parts: 'Auto Parts',
  garden_outdoor: 'Garden & Outdoor',
  musical_instruments: 'Musical Instruments',
  other: 'Other',
}
