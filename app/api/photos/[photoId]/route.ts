import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { deleteItemPhoto } from '@/services/items'

type Params = { params: Promise<{ photoId: string }> }

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  const { photoId } = await params
  const { db, blobs } = getAppContext()

  const deleted = await deleteItemPhoto(db, blobs, photoId)
  if (!deleted) return fail('not_found', 'That photo no longer exists.', 404)

  return ok({ deleted: true })
})
