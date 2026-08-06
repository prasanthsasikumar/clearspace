import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getBatchProgress } from '@/services/batches'

type Params = { params: Promise<{ batchId: string }> }

/** Polled by the progress screen while detection and grouping run. */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { batchId } = await params
  const { db } = getAppContext()

  const progress = await getBatchProgress(db, batchId)
  if (!progress) return fail('not_found', 'That upload no longer exists.', 404)

  return ok(progress)
})
