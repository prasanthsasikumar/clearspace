import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { requireSessionUser } from '@/server/auth'
import { getBatchProgress, listBatchPhotos } from '@/services/batches'
import { getLot } from '@/services/lots'

type Params = { params: Promise<{ batchId: string }> }

/**
 * The batch's photos and the boxes found in them so far.
 *
 * Polled alongside the counts while a batch is processing, so the waiting
 * screen can show boxes landing on the user's own photographs instead of a
 * spinner over a number.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { batchId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const progress = await getBatchProgress(db, batchId)
  if (!progress) return fail('not_found', 'That batch no longer exists.', 404)

  // The batch is addressed by an id the client already holds, so ownership is
  // checked against the lot rather than assumed from it.
  const lot = await getLot(db, user.id, progress.lotId)
  if (!lot) return fail('not_found', 'That batch no longer exists.', 404)

  return ok({ photos: await listBatchPhotos(db, batchId) })
})
