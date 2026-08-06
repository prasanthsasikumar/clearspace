import type { NextRequest } from 'next/server'
import { ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { promoteDetection } from '@/services/items'

type Params = { params: Promise<{ detectionId: string }> }

/**
 * Promotes a detection to an inventory item.
 *
 * Idempotent: tapping the same box twice returns the item that already exists
 * rather than creating a duplicate, which matters because a tap on a phone in
 * a dim storage unit is very often a double tap.
 */
export const POST = route(async (_request: NextRequest, { params }: Params) => {
  const { detectionId } = await params
  const { db, blobs } = getAppContext()
  return ok({ item: await promoteDetection(db, blobs, detectionId) }, 201)
})
