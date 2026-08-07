import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { buildLotExport } from '@/services/exports'

type Params = { params: Promise<{ lotId: string }> }

/**
 * What the export would contain, without downloading it — so the UI can warn
 * about missing prices and unchecked figures before the seller commits.
 */
export const GET = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const url = new URL(request.url)
  const result = await buildLotExport(db, { lotId: lot.id, origin: url.origin })

  return ok({
    rowCount: result.rowCount,
    skipped: result.skipped,
    warnings: result.warnings,
    unconfirmedPrices: result.unconfirmedPrices,
  })
})
