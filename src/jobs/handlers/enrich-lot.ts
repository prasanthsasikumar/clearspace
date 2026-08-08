import { z } from 'zod'
import type { Job } from '@/db/schema'
import { enrichLotFromSheet } from '@/services/enrichment'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({ lotId: z.string().uuid() })

/**
 * Names and prices a whole lot from one contact sheet.
 *
 * One job for a lot rather than one per item, because the saving is the point:
 * a lot of twenty five used to be fifty grounded calls and minutes of waiting
 * before the board said anything useful. Enqueued by grouping, so the board is
 * filling in by the time anyone reaches it.
 */
export const enrichLotHandler: JobHandler = async (ctx: JobContext, job: Job) => {
  const { lotId } = payloadSchema.parse(job.payload)
  return enrichLotFromSheet(ctx.db, ctx.blobs, ctx.enricher, lotId)
}
