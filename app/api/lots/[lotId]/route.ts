import type { NextRequest } from 'next/server'
import { fail, ok, parseBody, route } from '@/server/api'
import { updateLotSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { deleteLot, getLot, updateLot } from '@/services/lots'
import { listItems } from '@/services/items'
import { requireSessionUser } from '@/server/auth'

type Params = { params: Promise<{ lotId: string }> }

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  return ok({ lot, items: await listItems(db, lot.id) })
})

export const PATCH = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const input = await parseBody(request, updateLotSchema)
  const lot = await updateLot(db, user.id, lotId, input)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  return ok({ lot })
})

export const DELETE = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const deleted = await deleteLot(db, user.id, lotId)
  if (!deleted) return fail('not_found', 'That lot no longer exists.', 404)

  return ok({ deleted: true })
})
