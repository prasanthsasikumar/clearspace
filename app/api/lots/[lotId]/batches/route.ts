import type { NextRequest } from 'next/server'
import { assertUploadSize, fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { createBatch } from '@/services/batches'
import { getCurrentUser } from '@/services/user'
import type { UploadedFile } from '@/services/scans'

type Params = { params: Promise<{ lotId: string }> }

/** Photos uploaded together are analysed together and grouped together. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await getCurrentUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return fail('invalid_request', 'No photos were attached.', 422)
  }

  const uploads: UploadedFile[] = []
  for (const file of files) {
    assertUploadSize(file.size)
    uploads.push({
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
    })
  }

  const batch = await createBatch(db, blobs, { lotId: lot.id, files: uploads })
  return ok({ batchId: batch.batchId, photoCount: batch.scans.length }, 201)
})
