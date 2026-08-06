import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '@/db/client'
import { detections, jobs, lots, scanFrames, scans, type Job } from '@/db/schema'
import { makeBlobKey } from '@/storage'
import { setScanStatus } from '@/services/scans'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({
  scanId: z.string().uuid(),
  frameId: z.string().uuid().optional(),
})

export interface DetectObjectsResult {
  detectionCount: number
}

/**
 * Runs object detection over one scan image and records what it found.
 *
 * Detections are written even when the model returns nothing, so the review
 * screen can distinguish "we looked and found nothing" from "still working" —
 * an empty result is a real answer and gets its own coaching copy.
 */
export const detectObjectsHandler: JobHandler = async (
  ctx: JobContext,
  job: Job,
): Promise<DetectObjectsResult> => {
  const { scanId, frameId } = payloadSchema.parse(job.payload)
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
        confidence: object.confidence,
        maskBlobKey,
        source: 'model',
      })
    }

    await finalizeScanStatus(db, scanId, job.id)
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
 * A video walkthrough fans out into one detection job per keyframe. The scan
 * is only complete once none of its siblings are still outstanding, otherwise
 * the review screen would announce it was done after the first frame landed.
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
