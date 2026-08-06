import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getScanDetail } from '@/services/scans'

type Params = { params: Promise<{ scanId: string }> }

/**
 * The review screen polls this while detection runs. It returns the scan's
 * status alongside whatever detections exist so far, so boxes can appear as
 * they land rather than all at once at the end.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { scanId } = await params
  const { db } = getAppContext()

  const detail = await getScanDetail(db, scanId)
  if (!detail) return fail('not_found', 'That scan no longer exists.', 404)

  return ok(detail)
})
