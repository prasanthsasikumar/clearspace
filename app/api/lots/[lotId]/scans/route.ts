import type { NextRequest } from 'next/server'
import { assertUploadSize, fail, ok, route } from '@/server/api'
import { scanKindSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { createImageScan, createVideoScan } from '@/services/scans'
import { getCurrentUser } from '@/services/user'

type Params = { params: Promise<{ lotId: string }> }

/**
 * Accepts one or more images, or opens a video scan.
 *
 * Each image becomes its own scan rather than one scan with many images: the
 * user is usually shooting one wall or one shelf per photo, and keeping them
 * separate means detections stay attached to the picture they came from, so
 * the review screen can show boxes over the right image.
 */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await getCurrentUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const form = await request.formData()
  const rawKind = String(form.get('kind') ?? 'scene')

  if (rawKind === 'video') {
    const scan = await createVideoScan(db, { lotId })
    return ok({ scans: [scan], jobIds: [] }, 201)
  }

  const kind = scanKindSchema.parse(rawKind)
  const files = form.getAll('files').filter((f): f is File => f instanceof File)

  if (files.length === 0) {
    return fail('invalid_request', 'No photos were attached.', 422)
  }

  const created = []
  const jobIds = []
  for (const file of files) {
    assertUploadSize(file.size)
    const data = Buffer.from(await file.arrayBuffer())
    const result = await createImageScan(db, blobs, {
      lotId,
      kind,
      file: { data, mimeType: file.type || 'image/jpeg' },
    })
    created.push(result.scan)
    jobIds.push(result.jobId)
  }

  return ok({ scans: created, jobIds }, 201)
})
