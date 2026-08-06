import { z } from 'zod'
import type { Job } from '@/db/schema'
import { groupBatchIntoItems, type GroupingResult } from '@/services/grouping'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({
  batchId: z.string().uuid(),
  lotId: z.string().uuid(),
})

/**
 * Groups a finished batch into items. Enqueued by whichever detection job
 * finishes last, so it always sees every photo's detections.
 */
export const groupObjectsHandler: JobHandler = async (
  ctx: JobContext,
  job: Job,
): Promise<GroupingResult> => {
  const { batchId, lotId } = payloadSchema.parse(job.payload)
  return groupBatchIntoItems(ctx.db, ctx.blobs, ctx.matcher, { batchId, lotId })
}
