import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { dismissDetection } from '@/services/items'

type Params = { params: Promise<{ detectionId: string }> }

export const POST = route(async (_request: NextRequest, { params }: Params) => {
  const { detectionId } = await params
  const { db } = getAppContext()

  const dismissed = await dismissDetection(db, detectionId)
  if (!dismissed) return fail('not_found', 'That detection is already gone.', 404)

  return ok({ dismissed: true })
})
