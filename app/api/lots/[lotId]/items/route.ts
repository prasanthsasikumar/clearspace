import type { NextRequest } from 'next/server'
import { fail, ok, parseBody, route } from '@/server/api'
import { createItemSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { createItem, listItems } from '@/services/items'
import { getLot } from '@/services/lots'
import { getCurrentUser } from '@/services/user'

type Params = { params: Promise<{ lotId: string }> }

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await getCurrentUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  return ok({ items: await listItems(db, lot.id) })
})

/** Adds an item by hand, for things no photo caught. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await getCurrentUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const input = await parseBody(request, createItemSchema)
  const item = await createItem(db, lot.id, {
    title: input.title,
    category: input.category ?? null,
    brand: input.brand ?? null,
    model: input.model ?? null,
    condition: input.condition ?? null,
    userNotes: input.userNotes ?? null,
  })

  return ok({ item }, 201)
})
