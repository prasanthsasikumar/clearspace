import type { NextRequest } from 'next/server'
import { fail, ok, parseBody, route } from '@/server/api'
import { createDetectionSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { addManualDetection } from '@/services/items'
import { getScanDetail } from '@/services/scans'

type Params = { params: Promise<{ scanId: string }> }

/** Records a box the user drew around something the model missed. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { scanId } = await params
  const { db } = getAppContext()

  const detail = await getScanDetail(db, scanId)
  if (!detail) return fail('not_found', 'That scan no longer exists.', 404)

  const input = await parseBody(request, createDetectionSchema)
  const id = await addManualDetection(db, scanId, {
    label: input.label,
    category: input.category ?? null,
    bbox: input.bbox,
    frameId: input.frameId,
  })

  return ok({ detectionId: id }, 201)
})
