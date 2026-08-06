import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  detections,
  itemPhotos,
  items,
  scanFrames,
  scans,
  type Item,
  type ItemCondition,
  type ItemPhoto,
  type ItemStatus,
  type PhotoView,
} from '@/db/schema'
import { evaluateCoverage, type CoverageResult } from '@/domain/coverage'
import { isUsable } from '@/domain/image-quality'
import { assertTransition, deriveStatus } from '@/domain/item-status'
import type { BoundingBox } from '@/domain/geometry'
import { isItemCategory, type Dimensions, type ItemCategory } from '@/domain/types'
import { makeBlobKey, type BlobStore } from '@/storage'
import { enqueue } from '@/jobs/queue'
import { cropRegion, normalizeUpload } from './images'
import { touchLot } from './lots'

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

/* -------------------------------------------------------------------------- */
/* Promotion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turns a detection into an inventory item.
 *
 * The detected region is cut out of the scene photo and becomes the item's
 * first picture, so the item is recognisable in the inventory list before the
 * user has photographed it properly. The crop is tagged `other` rather than
 * `front` on purpose — it is a starting point, not a listing photo, and the
 * coverage checklist should still ask for a real front shot.
 */
export async function promoteDetection(
  db: Database,
  blobs: BlobStore,
  detectionId: string,
): Promise<Item> {
  const [row] = await db
    .select({
      detection: detections,
      scanBlobKey: scans.blobKey,
      lotId: scans.lotId,
      frameBlobKey: scanFrames.blobKey,
    })
    .from(detections)
    .innerJoin(scans, eq(scans.id, detections.scanId))
    .leftJoin(scanFrames, eq(scanFrames.id, detections.frameId))
    .where(eq(detections.id, detectionId))
    .limit(1)

  if (!row) throw new NotFoundError('Detection')

  if (row.detection.promotedItemId) {
    const existing = await getItem(db, row.detection.promotedItemId)
    if (existing) return existing
  }

  const sourceKey = row.frameBlobKey ?? row.scanBlobKey
  if (!sourceKey) throw new ConflictError('The source image for this detection is missing')

  const source = await blobs.get(sourceKey)
  if (!source) throw new ConflictError('The source image for this detection is missing')

  const crop = await cropRegion(source.data, row.detection.bbox as BoundingBox)
  const cropKey = makeBlobKey('items', crop.contentType)
  const stored = await blobs.put(cropKey, crop.data, crop.contentType)

  const category = row.detection.category
  const [item] = await db
    .insert(items)
    .values({
      lotId: row.lotId,
      title: toTitle(row.detection.label),
      category: category && isItemCategory(category) ? category : null,
      status: 'photos_needed',
      createdFromDetectionId: row.detection.id,
    })
    .returning()

  if (!item) throw new Error('Failed to create item')

  await db.insert(itemPhotos).values({
    itemId: item.id,
    blobKey: stored.key,
    view: 'other',
    isPrimary: true,
    width: crop.width,
    height: crop.height,
    byteSize: stored.byteSize,
  })

  await db
    .update(detections)
    .set({ promotedItemId: item.id })
    .where(eq(detections.id, detectionId))

  await touchLot(db, row.lotId)
  return item
}

export async function dismissDetection(db: Database, detectionId: string): Promise<boolean> {
  const updated = await db
    .update(detections)
    .set({ dismissedAt: new Date() })
    .where(and(eq(detections.id, detectionId), isNull(detections.dismissedAt)))
    .returning({ id: detections.id })
  return updated.length > 0
}

export async function updateDetection(
  db: Database,
  detectionId: string,
  input: { label?: string; category?: ItemCategory | null; bbox?: BoundingBox },
): Promise<boolean> {
  const updated = await db
    .update(detections)
    .set({
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.bbox !== undefined ? { bbox: input.bbox } : {}),
    })
    .where(eq(detections.id, detectionId))
    .returning({ id: detections.id })
  return updated.length > 0
}

/**
 * Records a box the user drew by hand.
 *
 * Every detector misses things, and in a storage unit the misses are often the
 * valuable items tucked behind something else. Without this the whole flow
 * dead-ends on a model failure, so it is not an optional nicety.
 */
export async function addManualDetection(
  db: Database,
  scanId: string,
  input: { label: string; category?: ItemCategory | null; bbox: BoundingBox; frameId?: string },
): Promise<string> {
  const [created] = await db
    .insert(detections)
    .values({
      scanId,
      frameId: input.frameId ?? null,
      label: input.label.trim(),
      category: input.category ?? null,
      bbox: input.bbox,
      confidence: null,
      source: 'user',
    })
    .returning({ id: detections.id })

  if (!created) throw new Error('Failed to record detection')
  return created.id
}

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

export interface ItemWithPrimaryPhoto extends Item {
  primaryPhotoKey: string | null
  photoCount: number
}

export async function listItems(
  db: Database,
  lotId: string,
): Promise<ItemWithPrimaryPhoto[]> {
  const rows = await db
    .select()
    .from(items)
    .where(eq(items.lotId, lotId))
    .orderBy(desc(items.createdAt))

  if (rows.length === 0) return []

  const photos = await db
    .select()
    .from(itemPhotos)
    .innerJoin(items, eq(items.id, itemPhotos.itemId))
    .where(eq(items.lotId, lotId))
    .orderBy(desc(itemPhotos.isPrimary), asc(itemPhotos.createdAt))

  const byItem = new Map<string, ItemPhoto[]>()
  for (const { item_photos: photo } of photos) {
    const bucket = byItem.get(photo.itemId) ?? []
    bucket.push(photo)
    byItem.set(photo.itemId, bucket)
  }

  return rows.map((item) => {
    const itemPhotoList = byItem.get(item.id) ?? []
    return {
      ...item,
      primaryPhotoKey: itemPhotoList[0]?.blobKey ?? null,
      photoCount: itemPhotoList.length,
    }
  })
}

export async function getItem(db: Database, itemId: string): Promise<Item | null> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1)
  return item ?? null
}

export interface ItemDetail {
  item: Item
  photos: ItemPhoto[]
  coverage: CoverageResult
}

export async function getItemDetail(
  db: Database,
  itemId: string,
): Promise<ItemDetail | null> {
  const item = await getItem(db, itemId)
  if (!item) return null

  const photos = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, itemId))
    .orderBy(desc(itemPhotos.isPrimary), asc(itemPhotos.createdAt))

  return { item, photos, coverage: coverageForPhotos(item, photos) }
}

function coverageForPhotos(item: Item, photos: readonly ItemPhoto[]): CoverageResult {
  return evaluateCoverage(
    item.category && isItemCategory(item.category) ? item.category : null,
    photos.map((p) => ({ view: p.view, usable: isUsable(p.quality) })),
  )
}

export interface CreateItemInput {
  title: string
  category?: ItemCategory | null
  brand?: string | null
  model?: string | null
  condition?: ItemCondition | null
  userNotes?: string | null
}

export async function createItem(
  db: Database,
  lotId: string,
  input: CreateItemInput,
): Promise<Item> {
  const [item] = await db
    .insert(items)
    .values({
      lotId,
      title: input.title.trim(),
      category: input.category ?? null,
      brand: input.brand?.trim() || null,
      model: input.model?.trim() || null,
      condition: input.condition ?? null,
      userNotes: input.userNotes?.trim() || null,
      status: 'photos_needed',
    })
    .returning()

  if (!item) throw new Error('Failed to create item')
  await touchLot(db, lotId)
  return item
}

export interface UpdateItemInput {
  title?: string
  category?: ItemCategory | null
  brand?: string | null
  model?: string | null
  condition?: ItemCondition | null
  conditionNotes?: string | null
  dimensions?: Dimensions | null
  serialNumber?: string | null
  userNotes?: string | null
  status?: ItemStatus
}

export async function updateItem(
  db: Database,
  itemId: string,
  input: UpdateItemInput,
): Promise<Item | null> {
  const current = await getItem(db, itemId)
  if (!current) return null

  // A status change coming from the client is a user decision, so it is
  // validated against the machine rather than trusted.
  if (input.status !== undefined) assertTransition(current.status, input.status)

  const [updated] = await db
    .update(items)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.brand !== undefined ? { brand: input.brand?.trim() || null } : {}),
      ...(input.model !== undefined ? { model: input.model?.trim() || null } : {}),
      ...(input.condition !== undefined ? { condition: input.condition } : {}),
      ...(input.conditionNotes !== undefined
        ? { conditionNotes: input.conditionNotes?.trim() || null }
        : {}),
      ...(input.dimensions !== undefined ? { dimensions: input.dimensions } : {}),
      ...(input.serialNumber !== undefined
        ? { serialNumber: input.serialNumber?.trim() || null }
        : {}),
      ...(input.userNotes !== undefined
        ? { userNotes: input.userNotes?.trim() || null }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(items.id, itemId))
    .returning()

  if (!updated) return null

  // Changing the category changes which photos are required, so coverage is
  // re-evaluated unless the user just set the status themselves.
  if (input.category !== undefined && input.status === undefined) {
    return (await recomputeItemStatus(db, itemId)) ?? updated
  }

  await touchLot(db, updated.lotId)
  return updated
}

export async function deleteItem(db: Database, itemId: string): Promise<boolean> {
  const deleted = await db.delete(items).where(eq(items.id, itemId)).returning({ id: items.id })
  return deleted.length > 0
}

/* -------------------------------------------------------------------------- */
/* Photos                                                                     */
/* -------------------------------------------------------------------------- */

export async function addItemPhoto(
  db: Database,
  blobs: BlobStore,
  itemId: string,
  input: { data: Buffer; mimeType: string; view: PhotoView; quality?: unknown },
): Promise<ItemPhoto> {
  const item = await getItem(db, itemId)
  if (!item) throw new NotFoundError('Item')

  const normalized = await normalizeUpload(input.data)
  const key = makeBlobKey('items', normalized.contentType)
  const stored = await blobs.put(key, normalized.data, normalized.contentType)

  const existing = await db
    .select({ id: itemPhotos.id })
    .from(itemPhotos)
    .where(and(eq(itemPhotos.itemId, itemId), eq(itemPhotos.isPrimary, true)))
    .limit(1)

  const [photo] = await db
    .insert(itemPhotos)
    .values({
      itemId,
      blobKey: stored.key,
      view: input.view,
      // The auto-crop holds the primary slot until a real photo arrives.
      isPrimary: existing.length === 0 || input.view === 'front',
      width: normalized.width,
      height: normalized.height,
      byteSize: stored.byteSize,
      quality: (input.quality as ItemPhoto['quality']) ?? null,
    })
    .returning()

  if (!photo) throw new Error('Failed to record photo')

  if (photo.isPrimary) {
    await db
      .update(itemPhotos)
      .set({ isPrimary: false })
      .where(and(eq(itemPhotos.itemId, itemId), eq(itemPhotos.isPrimary, true)))
    await db.update(itemPhotos).set({ isPrimary: true }).where(eq(itemPhotos.id, photo.id))
  }

  await recomputeItemStatus(db, itemId)
  await touchLot(db, item.lotId)
  await enqueue(db, 'assess_photo', { photoId: photo.id })
  return photo
}

export async function deleteItemPhoto(
  db: Database,
  blobs: BlobStore,
  photoId: string,
): Promise<boolean> {
  const [photo] = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.id, photoId))
    .limit(1)
  if (!photo) return false

  await db.delete(itemPhotos).where(eq(itemPhotos.id, photoId))
  await blobs.delete(photo.blobKey)

  if (photo.isPrimary) {
    const [next] = await db
      .select({ id: itemPhotos.id })
      .from(itemPhotos)
      .where(eq(itemPhotos.itemId, photo.itemId))
      .orderBy(asc(itemPhotos.createdAt))
      .limit(1)
    if (next) {
      await db.update(itemPhotos).set({ isPrimary: true }).where(eq(itemPhotos.id, next.id))
    }
  }

  await recomputeItemStatus(db, photo.itemId)
  return true
}

/**
 * Re-derives an item's status from its current photo coverage. Called whenever
 * photos or category change; a no-op for items the user has already confirmed.
 */
export async function recomputeItemStatus(
  db: Database,
  itemId: string,
): Promise<Item | null> {
  const detail = await getItemDetail(db, itemId)
  if (!detail) return null

  const next = deriveStatus(detail.item.status, {
    coverageComplete: detail.coverage.isListable,
  })
  if (next === detail.item.status) return detail.item

  const [updated] = await db
    .update(items)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(items.id, itemId))
    .returning()

  return updated ?? detail.item
}

function toTitle(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length === 0) return 'Untitled item'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
