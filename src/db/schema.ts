import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { BoundingBox } from '@/domain/geometry'
import type { Dimensions, PhotoQuality } from '@/domain/types'

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const lotKind = pgEnum('lot_kind', [
  'storage_unit',
  'garage',
  'home',
  'estate',
  'office',
  'other',
])

export const scanKind = pgEnum('scan_kind', ['scene', 'photo', 'video'])

export const scanStatus = pgEnum('scan_status', [
  'uploaded',
  'processing',
  'complete',
  'failed',
])

export const itemStatus = pgEnum('item_status', [
  'detected',
  'photos_needed',
  'ai_identified',
  'needs_confirmation',
  'confirmed',
  'listed',
  'sold',
  'discarded',
])

export const itemCondition = pgEnum('item_condition', [
  'new',
  'like_new',
  'excellent',
  'good',
  'fair',
  'poor',
  'for_parts',
])

export const photoView = pgEnum('photo_view', [
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

export const jobStatus = pgEnum('job_status', [
  'pending',
  'running',
  'complete',
  'failed',
])

export const marketplace = pgEnum('marketplace', [
  'facebook',
  'ebay',
  'craigslist',
  'offerup',
  'generic',
])

export const detectionSource = pgEnum('detection_source', ['model', 'user'])

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_idx').on(t.email)])

export const lots = pgTable('lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: lotKind('kind').notNull().default('other'),
  locationText: text('location_text'),
  notes: text('notes'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lots_user_idx').on(t.userId)])

export const scans = pgTable('scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  lotId: uuid('lot_id')
    .notNull()
    .references(() => lots.id, { onDelete: 'cascade' }),
  /**
   * Photos uploaded together share a batch, and cross-photo grouping runs per
   * batch. Null for the single-scan path, which predates batches.
   */
  batchId: uuid('batch_id'),
  kind: scanKind('kind').notNull(),
  /** Null for video scans, whose imagery lives in `scan_frames`. */
  blobKey: text('blob_key'),
  mimeType: text('mime_type'),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size'),
  status: scanStatus('status').notNull().default('uploaded'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('scans_lot_idx').on(t.lotId), index('scans_batch_idx').on(t.batchId)])

export const scanFrames = pgTable('scan_frames', {
  id: uuid('id').primaryKey().defaultRandom(),
  scanId: uuid('scan_id')
    .notNull()
    .references(() => scans.id, { onDelete: 'cascade' }),
  blobKey: text('blob_key').notNull(),
  tMs: integer('t_ms').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  /** Laplacian variance measured on-device; higher is sharper. */
  sharpness: real('sharpness'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('scan_frames_scan_idx').on(t.scanId)])

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  lotId: uuid('lot_id')
    .notNull()
    .references(() => lots.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  category: text('category'),
  brand: text('brand'),
  model: text('model'),
  condition: itemCondition('condition'),
  conditionNotes: text('condition_notes'),
  dimensions: jsonb('dimensions').$type<Dimensions>(),
  serialNumber: text('serial_number'),
  userNotes: text('user_notes'),
  /** Null until the Phase 3 pricing pipeline runs. Never guessed. */
  estimatedValueCents: integer('estimated_value_cents'),
  /** True until a human has actually looked at the suggested price. */
  priceUnconfirmed: boolean('price_unconfirmed').notNull().default(true),
  currency: text('currency').notNull().default('USD'),
  status: itemStatus('status').notNull().default('detected'),
  createdFromDetectionId: uuid('created_from_detection_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('items_lot_idx').on(t.lotId), index('items_status_idx').on(t.status)])

export const detections = pgTable('detections', {
  id: uuid('id').primaryKey().defaultRandom(),
  scanId: uuid('scan_id')
    .notNull()
    .references(() => scans.id, { onDelete: 'cascade' }),
  frameId: uuid('frame_id').references(() => scanFrames.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  category: text('category'),
  /** Normalized fractions of image size, origin top-left. See domain/geometry. */
  bbox: jsonb('bbox').$type<BoundingBox>().notNull(),
  /**
   * The isolated object, cut out during detection. It is what the matcher
   * compares and what becomes the item's view — cutting it twice would be
   * wasted work on every single detection.
   */
  cropBlobKey: text('crop_blob_key'),
  maskBlobKey: text('mask_blob_key'),
  confidence: real('confidence'),
  source: detectionSource('source').notNull().default('model'),
  promotedItemId: uuid('promoted_item_id').references(() => items.id, {
    onDelete: 'set null',
  }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('detections_scan_idx').on(t.scanId)])

export const itemPhotos = pgTable('item_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  blobKey: text('blob_key').notNull(),
  /** Which crop, and so which original photo, this view came from. */
  sourceDetectionId: uuid('source_detection_id'),
  view: photoView('view').notNull().default('other'),
  isPrimary: boolean('is_primary').notNull().default(false),
  width: integer('width'),
  height: integer('height'),
  byteSize: integer('byte_size'),
  quality: jsonb('quality').$type<PhotoQuality>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('item_photos_item_idx').on(t.itemId)])

/* --- Phase 2 --------------------------------------------------------------- */

export const identifications = pgTable('identifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  productName: text('product_name'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  msrpCents: integer('msrp_cents'),
  confidence: real('confidence'),
  sources: jsonb('sources').$type<Array<{ title: string; url: string }>>(),
  raw: jsonb('raw'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('identifications_item_idx').on(t.itemId)])

/* --- Phase 3 --------------------------------------------------------------- */

export const valuations = pgTable('valuations', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  conditionTier: itemCondition('condition_tier').notNull(),
  lowCents: integer('low_cents').notNull(),
  highCents: integer('high_cents').notNull(),
  recommendedCents: integer('recommended_cents').notNull(),
  comparables: jsonb('comparables'),
  method: text('method').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('valuations_item_idx').on(t.itemId)])

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  marketplace: marketplace('marketplace').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull(),
  negotiationLowCents: integer('negotiation_low_cents'),
  categoryPath: text('category_path'),
  conditionLabel: text('condition_label'),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('listings_item_idx').on(t.itemId)])

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  lotId: uuid('lot_id')
    .notNull()
    .references(() => lots.id, { onDelete: 'cascade' }),
  marketplace: marketplace('marketplace').notNull(),
  format: text('format').notNull(),
  blobKey: text('blob_key').notNull(),
  itemCount: integer('item_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/* --- Infrastructure -------------------------------------------------------- */

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  status: jobStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  lastError: text('last_error'),
  result: jsonb('result'),
  runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('jobs_claim_idx').on(t.status, t.runAfter)])

/* -------------------------------------------------------------------------- */
/* Inferred row types                                                         */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect
export type Lot = typeof lots.$inferSelect
export type NewLot = typeof lots.$inferInsert
export type Scan = typeof scans.$inferSelect
export type ScanFrame = typeof scanFrames.$inferSelect
export type Detection = typeof detections.$inferSelect
export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
export type ItemPhoto = typeof itemPhotos.$inferSelect
export type Identification = typeof identifications.$inferSelect
export type Valuation = typeof valuations.$inferSelect
export type Listing = typeof listings.$inferSelect
export type Job = typeof jobs.$inferSelect

export type ItemStatus = (typeof itemStatus.enumValues)[number]
export type ItemCondition = (typeof itemCondition.enumValues)[number]
export type PhotoView = (typeof photoView.enumValues)[number]
export type LotKind = (typeof lotKind.enumValues)[number]
export type ScanKind = (typeof scanKind.enumValues)[number]
