import type { NextRequest } from 'next/server'
import { fail, ok, parseBody, route } from '@/server/api'
import { updateItemSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { deleteItem, getItemDetail, updateItem } from '@/services/items'
import { getEnrichment } from '@/services/enrichment'

type Params = { params: Promise<{ itemId: string }> }

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { itemId } = await params
  const { db } = getAppContext()

  const detail = await getItemDetail(db, itemId)
  if (!detail) return fail('not_found', 'That item no longer exists.', 404)

  return ok({ ...detail, ...(await getEnrichment(db, itemId)) })
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  const { itemId } = await params
  const { db } = getAppContext()

  const input = await parseBody(request, updateItemSchema)
  const item = await updateItem(db, itemId, input)
  if (!item) return fail('not_found', 'That item no longer exists.', 404)

  const detail = await getItemDetail(db, itemId)
  return ok({ ...detail, ...(await getEnrichment(db, itemId)) })
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  const { itemId } = await params
  const { db } = getAppContext()

  const deleted = await deleteItem(db, itemId)
  if (!deleted) return fail('not_found', 'That item no longer exists.', 404)

  return ok({ deleted: true })
})
