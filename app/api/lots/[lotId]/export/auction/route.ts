import { NextResponse, type NextRequest } from 'next/server'
import { fail, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { buildLotAuctionExport } from '@/services/exports'

type Params = { params: Promise<{ lotId: string }> }

/**
 * Downloads the auction bundle: one ZIP holding lots.csv and its photographs.
 *
 * Unlike the Facebook feed this needs no origin, because nothing in it is a
 * URL. The photographs are in the archive, which is what makes the file useful
 * on an auctioneer's desktop rather than only on the machine that made it.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })

  return new NextResponse(new Uint8Array(result.archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Clearspace-Rows': String(result.rowCount),
      'X-Clearspace-Skipped': String(result.skipped.length),
      'X-Clearspace-Unconfirmed': String(result.unconfirmedPrices),
    },
  })
})
