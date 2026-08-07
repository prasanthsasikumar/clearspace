import { and, count, countDistinct, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { detections, jobs, scans, type Scan } from '@/db/schema'
import type { BlobStore } from '@/storage'
import { enqueue } from '@/jobs/queue'
import { createImageScan, type UploadedFile } from './scans'
import { touchLot } from './lots'

export interface BatchCreated {
  batchId: string
  scans: Scan[]
  jobIds: string[]
}

/**
 * Accepts a pile of photos as one unit of work.
 *
 * The batch is what makes cross-photo grouping possible: photos taken in one
 * walk around a space belong together, and an object appearing in three of them
 * is one listing. Each photo still gets its own scan row and its own detection
 * job (they run concurrently and fail independently), but they share a batch
 * id, and the last job to finish starts the grouping pass.
 */
export async function createBatch(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string; files: readonly UploadedFile[] },
): Promise<BatchCreated> {
  if (input.files.length === 0) throw new Error('A batch needs at least one photo')

  const batchId = crypto.randomUUID()
  const scans = await addToBatch(db, blobs, { lotId: input.lotId, batchId, files: input.files })
  const jobIds = await sealBatch(db, input.lotId, batchId)

  return { batchId, scans, jobIds }
}

/**
 * Adds photos to a batch without starting any analysis.
 *
 * A storage unit has one bar of signal, and the whole batch used to go up in a
 * single request: twenty photos in one POST, so a drop at ninety percent lost
 * all twenty and the walk around the unit had to be repeated. Photos arrive
 * one at a time now, and a drop costs the one that was in flight.
 *
 * Nothing is enqueued here. The fan-in that starts grouping fires when no
 * detection jobs remain outstanding for the batch, so a photo analysed while
 * its siblings are still uploading would group alone and cross-photo matching,
 * the reason this app exists, would never happen.
 */
export async function addToBatch(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string; batchId: string; files: readonly UploadedFile[] },
): Promise<Scan[]> {
  const created: Scan[] = []
  for (const file of input.files) {
    const result = await createImageScan(db, blobs, {
      lotId: input.lotId,
      kind: 'photo',
      file,
      batchId: input.batchId,
      defer: true,
    })
    created.push(result.scan)
  }
  return created
}

export interface UploadedPhoto {
  blobKey: string
  mimeType: string
  width: number
  height: number
  byteSize: number
}

/**
 * Records photos the browser already put in storage.
 *
 * The dimensions come from the client because nothing here ever holds the
 * bytes: they went straight to the bucket. That is safe to take at face value
 * because it is the uploader's own lot and the numbers are descriptive, not
 * load-bearing. Everything that acts on a photo, detection included, reads the
 * blob itself.
 *
 * Server-side normalisation is skipped for the same reason it can be: the
 * browser already rotated by EXIF and capped the long edge before sending,
 * which is what turns a 12MB HEIC into a 400KB JPEG and a 40-second upload
 * into a 2-second one.
 */
export async function addUploadedToBatch(
  db: Database,
  input: { lotId: string; batchId: string; photos: readonly UploadedPhoto[] },
): Promise<Scan[]> {
  const created: Scan[] = []

  for (const photo of input.photos) {
    const [scan] = await db
      .insert(scans)
      .values({
        lotId: input.lotId,
        batchId: input.batchId,
        kind: 'photo',
        blobKey: photo.blobKey,
        mimeType: photo.mimeType,
        width: photo.width,
        height: photo.height,
        byteSize: photo.byteSize,
        status: 'uploaded',
      })
      .returning()

    if (!scan) throw new Error('Failed to record scan')
    created.push(scan)
  }

  await touchLot(db, input.lotId)
  return created
}

/**
 * Closes a batch and starts analysing all of it at once.
 *
 * Safe to call twice: a scan that already has a detection job is skipped, so a
 * retried seal after a dropped response does not analyse anything twice.
 */
export async function sealBatch(
  db: Database,
  lotId: string,
  batchId: string,
): Promise<string[]> {
  const pending = await db.select().from(scans).where(eq(scans.batchId, batchId))

  const existing = await db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.type, 'detect_objects'), sql`${jobs.payload}->>'batchId' = ${batchId}`))
  const already = new Set(
    existing.map((row) => (row.payload as { scanId?: string }).scanId).filter(Boolean),
  )

  const jobIds: string[] = []
  for (const scan of pending) {
    if (already.has(scan.id)) continue
    const job = await enqueue(db, 'detect_objects', { scanId: scan.id, batchId })
    jobIds.push(job.id)
  }

  await touchLot(db, lotId)
  return jobIds
}

export type BatchPhase = 'analysing' | 'grouping' | 'complete' | 'failed'

export interface BatchProgress {
  batchId: string
  lotId: string
  phase: BatchPhase
  photoCount: number
  analysedCount: number
  failedCount: number
  detectionCount: number
  itemCount: number
  /** Set when grouping finished; null while it is still outstanding. */
  multiViewItems: number | null
}

/**
 * The numbers behind the progress screen.
 *
 * Someone who has just uploaded thirty photos is going to sit through a minute
 * or two of processing, and a bare spinner over that span reads as broken. Each
 * of these counts moves visibly while the work happens, which is the whole
 * reason they are computed separately rather than reduced to a percentage.
 */
export async function getBatchProgress(
  db: Database,
  batchId: string,
): Promise<BatchProgress | null> {
  const batchScans = await db
    .select({ id: scans.id, lotId: scans.lotId, status: scans.status })
    .from(scans)
    .where(eq(scans.batchId, batchId))

  const first = batchScans[0]
  if (!first) return null

  const scanIds = batchScans.map((s) => s.id)

  const [[detectionRow], [itemRow], [groupingJob]] = await Promise.all([
    db
      .select({ total: count() })
      .from(detections)
      .where(inArray(detections.scanId, scanIds)),
    db
      .select({ total: countDistinct(detections.promotedItemId) })
      .from(detections)
      .where(
        and(inArray(detections.scanId, scanIds), isNotNull(detections.promotedItemId)),
      ),
    db
      .select({ status: jobs.status, result: jobs.result })
      .from(jobs)
      .where(
        and(eq(jobs.type, 'group_objects'), sql`${jobs.payload}->>'batchId' = ${batchId}`),
      )
      .limit(1),
  ])

  const analysedCount = batchScans.filter(
    (s) => s.status === 'complete' || s.status === 'failed',
  ).length
  const failedCount = batchScans.filter((s) => s.status === 'failed').length

  const grouped = groupingJob?.status === 'complete'
  const groupingFailed = groupingJob?.status === 'failed'

  let phase: BatchPhase = 'analysing'
  if (groupingFailed || (failedCount === batchScans.length && failedCount > 0)) {
    phase = 'failed'
  } else if (grouped) {
    phase = 'complete'
  } else if (analysedCount === batchScans.length) {
    phase = 'grouping'
  }

  const result = groupingJob?.result as { multiViewItems?: number } | null | undefined

  return {
    batchId,
    lotId: first.lotId,
    phase,
    photoCount: batchScans.length,
    analysedCount,
    failedCount,
    detectionCount: detectionRow?.total ?? 0,
    itemCount: itemRow?.total ?? 0,
    multiViewItems: grouped ? (result?.multiViewItems ?? 0) : null,
  }
}

/** Scans belonging to a batch, for the "fix a miss" path into the review canvas. */
export async function listBatchScans(db: Database, batchId: string): Promise<Scan[]> {
  return db.select().from(scans).where(eq(scans.batchId, batchId))
}
