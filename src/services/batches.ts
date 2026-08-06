import { and, count, countDistinct, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { detections, jobs, scans, type Scan } from '@/db/schema'
import type { BlobStore } from '@/storage'
import { createImageScan, type UploadedFile } from './scans'

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
 * job — they run concurrently and fail independently — but they share a batch
 * id, and the last job to finish starts the grouping pass.
 */
export async function createBatch(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string; files: readonly UploadedFile[] },
): Promise<BatchCreated> {
  if (input.files.length === 0) throw new Error('A batch needs at least one photo')

  const batchId = crypto.randomUUID()
  const created: Scan[] = []
  const jobIds: string[] = []

  for (const file of input.files) {
    const result = await createImageScan(db, blobs, {
      lotId: input.lotId,
      kind: 'photo',
      file,
      batchId,
    })
    created.push(result.scan)
    jobIds.push(result.jobId)
  }

  return { batchId, scans: created, jobIds }
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
