import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'
import { makeBlobKey } from '@/storage'

type Params = { params: Promise<{ lotId: string }> }

const bodySchema = z.object({
  /** One entry per photo about to be sent. */
  photos: z.array(z.object({ mimeType: z.string().min(1) })).min(1).max(60),
})

/**
 * Hands the browser somewhere to put photos.
 *
 * The bytes go to storage rather than through here. A serverless function
 * charged for the whole time an upload is in flight is charged for most of the
 * time there is when the signal is one bar, and a request body limit is a cap
 * on how many photos a walk around a unit may contain. This returns a signed
 * target per photo instead, and the app records what arrived afterwards.
 *
 * `direct: false` means the configured driver has no such thing, which is the
 * case on local disk, and the client posts the files the old way.
 */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return fail('invalid_request', 'Ask for at least one upload.', 422)

  if (!blobs.createUploadTarget) return ok({ direct: false, targets: [] })

  const targets = []
  for (const photo of parsed.data.photos) {
    const key = makeBlobKey('scans', photo.mimeType)
    const target = await blobs.createUploadTarget(key, photo.mimeType)
    // One refusal means the driver cannot do this today; falling back whole
    // beats a batch half of which went one way and half the other.
    if (!target) return ok({ direct: false, targets: [] })
    targets.push({ key, url: target.url, headers: target.headers })
  }

  return NextResponse.json({ direct: true, targets })
})
