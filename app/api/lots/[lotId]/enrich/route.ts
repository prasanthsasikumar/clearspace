import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { fail, ok, parseBody, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { getEnrichmentProgress, requestEnrichment } from '@/services/enrichment'

type Params = { params: Promise<{ lotId: string }> }

const bodySchema = z.object({ itemIds: z.array(z.string().uuid()).min(1) })

/** Queues research for the items the user approved. Two model calls each. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const { itemIds } = await parseBody(request, bodySchema)
  return ok(await requestEnrichment(db, lot.id, itemIds), 202)
})

/** Polled by the progress screen. */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  return ok(await getEnrichmentProgress(db, lot.id))
})
