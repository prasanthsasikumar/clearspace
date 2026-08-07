import { NextResponse, type NextRequest } from 'next/server'
import { fail, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { buildLotMarketplaceExport } from '@/services/exports'
import { buildXlsx } from '@/lib/xlsx'

type Params = { params: Promise<{ lotId: string }> }

/**
 * The Marketplace bulk-upload workbook, ready to hand back to Facebook.
 *
 * A workbook rather than a CSV because that is what the template asks to be
 * returned as, and the sheet reproduces the template's own four preamble rows
 * so the file Facebook receives is the shape it handed out.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const result = await buildLotMarketplaceExport(db, { lotId: lot.id })
  const workbook = buildXlsx('Bulk Upload Template', result.rows)

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'X-Clearspace-Rows': String(result.rowCount),
      'X-Clearspace-Skipped': String(result.skipped.length),
    },
  })
})
