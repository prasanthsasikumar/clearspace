import { z } from 'zod'
import type { Job } from '@/db/schema'
import { enrichItem } from '@/services/enrichment'
import type { JobContext, JobHandler } from '../worker'

const payloadSchema = z.object({ itemId: z.string().uuid() })

/**
 * Researches and writes one listing. Two model calls, so it belongs on the
 * queue rather than in a request: a fifteen-item lot is thirty calls and
 * several minutes.
 */
export const enrichItemHandler: JobHandler = async (ctx: JobContext, job: Job) => {
  const { itemId } = payloadSchema.parse(job.payload)
  const result = await enrichItem(ctx.db, ctx.blobs, ctx.enricher, itemId)
  return {
    title: result.listing?.title ?? null,
    priceCents: result.valuation?.recommendedCents ?? null,
    sourceCount: (result.identification?.sources ?? []).length,
  }
}
