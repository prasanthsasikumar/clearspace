import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  detections,
  scanFrames,
  scans,
  type Detection,
  type Scan,
  type ScanFrame,
  type ScanKind,
} from '@/db/schema'
import { makeBlobKey, type BlobStore } from '@/storage'
import { enqueue } from '@/jobs/queue'
import { normalizeUpload } from './images'
import { touchLot } from './lots'

export interface UploadedFile {
  data: Buffer
  mimeType: string
}

/**
 * Stores one uploaded image and queues it for detection.
 *
 * The scan row is written before the job is enqueued so the client always has
 * something to navigate to and poll, even if the worker is busy or the model
 * is slow. The user should never be staring at a blank screen wondering
 * whether their upload landed.
 */
export async function createImageScan(
  db: Database,
  blobs: BlobStore,
  input: {
    lotId: string
    kind: Extract<ScanKind, 'scene' | 'photo'>
    file: UploadedFile
    /** Photos uploaded together share a batch and are grouped together. */
    batchId?: string
    /**
     * Hold the detection job back.
     *
     * A batch uploaded photo by photo would otherwise start grouping the
     * moment the first photo's detection finished, because the fan-in fires
     * when no detection jobs remain outstanding. Grouping one photo alone
     * throws away cross-photo matching, which is the whole product. The
     * caller seals the batch and enqueues the lot of them together.
     */
    defer?: boolean
  },
): Promise<{ scan: Scan; jobId: string | null }> {
  const normalized = await normalizeUpload(input.file.data)
  const key = makeBlobKey('scans', normalized.contentType)
  const stored = await blobs.put(key, normalized.data, normalized.contentType)

  const [scan] = await db
    .insert(scans)
    .values({
      lotId: input.lotId,
      batchId: input.batchId ?? null,
      kind: input.kind,
      blobKey: stored.key,
      mimeType: stored.contentType,
      width: normalized.width,
      height: normalized.height,
      byteSize: stored.byteSize,
      status: 'uploaded',
    })
    .returning()

  if (!scan) throw new Error('Failed to record scan')

  const job = input.defer
    ? null
    : await enqueue(db, 'detect_objects', {
        scanId: scan.id,
        ...(input.batchId ? { batchId: input.batchId } : {}),
      })
  await touchLot(db, input.lotId)

  return { scan, jobId: job?.id ?? null }
}

/** Creates the parent row for a video walkthrough; frames arrive separately. */
export async function createVideoScan(
  db: Database,
  input: { lotId: string },
): Promise<Scan> {
  const [scan] = await db
    .insert(scans)
    .values({ lotId: input.lotId, kind: 'video', status: 'uploaded' })
    .returning()

  if (!scan) throw new Error('Failed to record scan')
  await touchLot(db, input.lotId)
  return scan
}

export interface FrameUpload extends UploadedFile {
  tMs: number
  sharpness?: number
}

/**
 * Attaches keyframes pulled out of a walkthrough video.
 *
 * Extraction happens in the browser (seeking a `<video>` element and drawing
 * to a canvas), which avoids an ffmpeg dependency entirely and means only
 * sharp, distinct frames ever leave the phone. Each frame is detected
 * independently; duplicates across frames are the user's to dismiss, since
 * only they know whether two similar chairs are one chair seen twice.
 */
export async function addScanFrames(
  db: Database,
  blobs: BlobStore,
  scanId: string,
  frames: readonly FrameUpload[],
): Promise<{ frames: ScanFrame[]; jobIds: string[] }> {
  const inserted: ScanFrame[] = []
  const jobIds: string[] = []

  for (const frame of frames) {
    const normalized = await normalizeUpload(frame.data, 1600)
    const key = makeBlobKey('frames', normalized.contentType)
    const stored = await blobs.put(key, normalized.data, normalized.contentType)

    const [row] = await db
      .insert(scanFrames)
      .values({
        scanId,
        blobKey: stored.key,
        tMs: frame.tMs,
        width: normalized.width,
        height: normalized.height,
        sharpness: frame.sharpness ?? null,
      })
      .returning()

    if (!row) throw new Error('Failed to record scan frame')
    inserted.push(row)

    const job = await enqueue(db, 'detect_objects', { scanId, frameId: row.id })
    jobIds.push(job.id)
  }

  return { frames: inserted, jobIds }
}

export interface ScanDetail {
  scan: Scan
  frames: ScanFrame[]
  detections: Detection[]
}

export async function getScanDetail(
  db: Database,
  scanId: string,
): Promise<ScanDetail | null> {
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId)).limit(1)
  if (!scan) return null

  const [frames, found] = await Promise.all([
    db
      .select()
      .from(scanFrames)
      .where(eq(scanFrames.scanId, scanId))
      .orderBy(asc(scanFrames.tMs)),
    db
      .select()
      .from(detections)
      .where(and(eq(detections.scanId, scanId), isNull(detections.dismissedAt))),
  ])

  return { scan, frames, detections: found }
}

export async function listScansForLot(db: Database, lotId: string): Promise<Scan[]> {
  return db.select().from(scans).where(eq(scans.lotId, lotId)).orderBy(asc(scans.createdAt))
}

export async function setScanStatus(
  db: Database,
  scanId: string,
  status: Scan['status'],
  error?: string | null,
): Promise<void> {
  await db
    .update(scans)
    .set({ status, error: error ?? null })
    .where(eq(scans.id, scanId))
}
