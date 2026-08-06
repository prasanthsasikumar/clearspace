import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { itemPhotos, items, type Job } from '@/db/schema'
import { recomputeItemStatus } from '@/services/items'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({ photoId: z.string().uuid() })

export interface AssessPhotoResult {
  issues: string[]
  suggestion: string | null
}

/**
 * Second-pass photo assessment.
 *
 * The browser already scored sharpness and exposure before upload; this asks
 * the harder question the client cannot answer — is the thing this photo was
 * meant to show actually legible? A serial-number close-up can be perfectly
 * sharp and still useless because the sticker is out of frame.
 */
export const assessPhotoHandler: JobHandler = async (
  ctx: JobContext,
  job: Job,
): Promise<AssessPhotoResult> => {
  const { photoId } = payloadSchema.parse(job.payload)
  const { db, blobs, vision } = ctx

  const [row] = await db
    .select({ photo: itemPhotos, itemTitle: items.title })
    .from(itemPhotos)
    .innerJoin(items, eq(items.id, itemPhotos.itemId))
    .where(eq(itemPhotos.id, photoId))
    .limit(1)

  if (!row) throw new Error(`Photo ${photoId} no longer exists`)

  const blob = await blobs.get(row.photo.blobKey)
  if (!blob) throw new Error(`Image ${row.photo.blobKey} is missing from storage`)

  const assessment = await vision.assessPhotoQuality({
    image: { data: blob.data, mimeType: blob.contentType },
    intendedView: row.photo.view,
    itemTitle: row.itemTitle,
  })

  // The client's measured blur and exposure are kept — they are physical
  // measurements, and the model's estimate of them is a guess. Only the
  // model's judgement about the subject is merged in.
  const merged = {
    blurScore: row.photo.quality?.blurScore ?? assessment.blurScore,
    exposure: row.photo.quality?.exposure ?? assessment.exposure,
    issues: [...new Set([...(row.photo.quality?.issues ?? []), ...assessment.issues])],
  }

  await db.update(itemPhotos).set({ quality: merged }).where(eq(itemPhotos.id, photoId))
  await recomputeItemStatus(db, row.photo.itemId)

  return { issues: merged.issues, suggestion: assessment.suggestion }
}
