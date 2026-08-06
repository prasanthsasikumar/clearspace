import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '@/db/client'
import { detections, jobs, lots, scanFrames, scans, type Job } from '@/db/schema'
import { makeBlobKey, type BlobStore } from '@/storage'
import { cropRegion } from '@/services/images'
import { setScanStatus } from '@/services/scans'
import { enqueue } from '../queue'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({
  scanId: z.string().uuid(),
  frameId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
})

export interface DetectObjectsResult {
  detectionCount: number
}

/**
 * Runs object detection over one scan image, cuts each detection out, and
 * records both.
 *
 * Detections are written even when the model returns nothing, so the review
 * screen can distinguish "we looked and found nothing" from "still working" —
 * an empty result is a real answer and gets its own coaching copy.
 */
export const detectObjectsHandler: JobHandler = async (
  ctx: JobContext,
  job: Job,
): Promise<DetectObjectsResult> => {
  const { scanId, frameId, batchId } = payloadSchema.parse(job.payload)
  const { db, blobs, vision } = ctx

  const [row] = await db
    .select({ scan: scans, lotKind: lots.kind, lotNotes: lots.notes })
    .from(scans)
    .innerJoin(lots, eq(lots.id, scans.lotId))
    .where(eq(scans.id, scanId))
    .limit(1)

  if (!row) throw new Error(`Scan ${scanId} no longer exists`)

  let blobKey = row.scan.blobKey
  if (frameId) {
    const [frame] = await db
      .select()
      .from(scanFrames)
      .where(eq(scanFrames.id, frameId))
      .limit(1)
    if (!frame) throw new Error(`Scan frame ${frameId} no longer exists`)
    blobKey = frame.blobKey
  }

  if (!blobKey) throw new Error(`Scan ${scanId} has no image to analyse`)

  await setScanStatus(db, scanId, 'processing')

  const blob = await blobs.get(blobKey)
  if (!blob) throw new Error(`Image ${blobKey} is missing from storage`)

  try {
    const found = await vision.detectObjects({
      image: { data: blob.data, mimeType: blob.contentType },
      context: {
        lotKind: row.lotKind,
        hint: row.lotNotes ?? undefined,
      },
    })

    for (const object of found) {
      // The crop is cut here, once. It is what the matcher compares and what
      // becomes the item's view; doing it twice would double the image work on
      // every detection in the lot.
      const cropBlobKey = await storeCrop(blobs, blob.data, object.bbox)

      let maskBlobKey: string | null = null
      if (object.maskPngBase64) {
        const key = makeBlobKey('masks', 'image/png')
        await blobs.put(key, Buffer.from(object.maskPngBase64, 'base64'), 'image/png')
        maskBlobKey = key
      }

      await db.insert(detections).values({
        scanId,
        frameId: frameId ?? null,
        label: object.label,
        category: object.category,
        bbox: object.bbox,
        cropBlobKey,
        maskBlobKey,
        confidence: object.confidence,
        source: 'model',
      })
    }

    await finalizeScanStatus(db, scanId, job.id)
    if (batchId) await maybeStartGrouping(db, batchId, row.scan.lotId, job.id)

    return { detectionCount: found.length }
  } catch (error) {
    // The queue will retry; only a terminal failure should mark the scan dead.
    await setScanStatus(
      db,
      scanId,
      'processing',
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}

/**
 * A failed crop must not fail the whole detection. Losing one thumbnail costs
 * the user a picture; losing the job costs them every detection in the photo.
 */
async function storeCrop(
  blobs: BlobStore,
  source: Buffer,
  bbox: { x: number; y: number; w: number; h: number },
): Promise<string | null> {
  try {
    const crop = await cropRegion(source, bbox)
    const key = makeBlobKey('items', crop.contentType)
    await blobs.put(key, crop.data, crop.contentType)
    return key
  } catch (error) {
    console.error('[detect] could not crop a detection', error)
    return null
  }
}

/**
 * A video walkthrough fans out into one detection job per keyframe. The scan is
 * only complete once none of its siblings are still outstanding, otherwise the
 * review screen would announce it was done after the first frame landed.
 */
async function finalizeScanStatus(
  db: Database,
  scanId: string,
  currentJobId: string,
): Promise<void> {
  const outstanding = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, 'detect_objects'),
        inArray(jobs.status, ['pending', 'running']),
        // This job is still marked `running` while its own handler executes.
        ne(jobs.id, currentJobId),
        sql`${jobs.payload}->>'scanId' = ${scanId}`,
      ),
    )
    .limit(1)

  await setScanStatus(db, scanId, outstanding.length > 0 ? 'processing' : 'complete', null)
}

/**
 * Fan-in for a batch: grouping can only run once every photo has been looked
 * at, so the last detection job out of the door starts it. Racing workers are
 * safe here — the check and the enqueue both go through the queue's own
 * transaction, and a duplicate grouping job would find every detection already
 * assigned and do nothing.
 */
async function maybeStartGrouping(
  db: Database,
  batchId: string,
  lotId: string,
  currentJobId: string,
): Promise<void> {
  const outstanding = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, 'detect_objects'),
        inArray(jobs.status, ['pending', 'running']),
        ne(jobs.id, currentJobId),
        sql`${jobs.payload}->>'batchId' = ${batchId}`,
      ),
    )
    .limit(1)

  if (outstanding.length > 0) return
  await enqueue(db, 'group_objects', { batchId, lotId })
}
