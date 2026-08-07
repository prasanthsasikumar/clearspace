import { NextResponse, type NextRequest } from 'next/server'
import { fail, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { buildLotExport } from '@/services/exports'

type Params = { params: Promise<{ lotId: string }> }

/**
 * Downloads the Facebook catalogue feed.
 *
 * The origin is taken from the request so `image_link` and `link` are absolute
 * and match however the user reached the app — a feed full of `localhost` URLs
 * would be silently useless to anyone but the machine that made it.
 */
export const GET = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const url = new URL(request.url)
  const result = await buildLotExport(db, { lotId: lot.id, origin: url.origin })

  return new NextResponse(result.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Clearspace-Rows': String(result.rowCount),
      'X-Clearspace-Skipped': String(result.skipped.length),
    },
  })
})
