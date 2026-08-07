import type { NextRequest } from 'next/server'
import { ok, parseBody, route } from '@/server/api'
import { createLotSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { createLot, listLots } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'

export const GET = route(async () => {
  const { db } = getAppContext()
  const user = await requireSessionUser(db)
  return ok({ lots: await listLots(db, user.id) })
})

export const POST = route(async (request: NextRequest) => {
  const { db } = getAppContext()
  const user = await requireSessionUser(db)
  const input = await parseBody(request, createLotSchema)
  return ok({ lot: await createLot(db, user.id, input) }, 201)
})
