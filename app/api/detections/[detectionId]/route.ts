import type { NextRequest } from 'next/server'
import { fail, ok, parseBody, route } from '@/server/api'
import { updateDetectionSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { updateDetection } from '@/services/items'

type Params = { params: Promise<{ detectionId: string }> }

/** Lets the user fix a wrong label or nudge a box before promoting it. */
export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  const { detectionId } = await params
  const { db } = getAppContext()

  const input = await parseBody(request, updateDetectionSchema)
  const updated = await updateDetection(db, detectionId, {
    label: input.label,
    category: input.category ?? undefined,
    bbox: input.bbox,
  })
  if (!updated) return fail('not_found', 'That detection no longer exists.', 404)

  return ok({ updated: true })
})
