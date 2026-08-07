import type { NextRequest } from 'next/server'
import { assertUploadSize, fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { z } from 'zod'
import { addToBatch, addUploadedToBatch, createBatch, sealBatch } from '@/services/batches'
import { requireSessionUser } from '@/server/auth'
import type { UploadedFile } from '@/services/scans'

type Params = { params: Promise<{ lotId: string }> }

/** Photos uploaded together are analysed together and grouped together. */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { lotId } = await params
  const { db, blobs } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) return fail('not_found', 'That lot no longer exists.', 404)

  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)

  /*
   * Photos arrive one request at a time so a dropped connection costs the
   * photo in flight rather than the whole walk around the unit. The client
   * owns the batch id, and `final` is what says the batch is complete and
   * analysis can start on all of it together.
   */
  const batchId = form.get('batchId')
  const final = form.get('final') === 'true'

  if (typeof batchId !== 'string' || !UUID.test(batchId)) {
    // No batch id: the whole pile in one request, which is still what the
    // tests and any older client do.
    if (files.length === 0) return fail('invalid_request', 'No photos were attached.', 422)
    const batch = await createBatch(db, blobs, { lotId: lot.id, files: await read(files) })
    return ok({ batchId: batch.batchId, photoCount: batch.scans.length }, 201)
  }

  if (files.length === 0 && !final) {
    return fail('invalid_request', 'No photos were attached.', 422)
  }

  if (files.length > 0) {
    await addToBatch(db, blobs, { lotId: lot.id, batchId, files: await read(files) })
  }

  /*
   * Photos that went straight to storage arrive here as keys rather than
   * bytes. The client sends what it already knows about each one, since
   * nothing on this side ever held the file.
   */
  const uploaded = form.get('uploaded')
  if (typeof uploaded === 'string' && uploaded.length > 0) {
    const parsed = uploadedSchema.safeParse(JSON.parse(uploaded))
    if (!parsed.success) {
      return fail('invalid_request', 'Those uploads could not be read.', 422)
    }
    await addUploadedToBatch(db, { lotId: lot.id, batchId, photos: parsed.data })
  }

  const jobIds = final ? await sealBatch(db, lot.id, batchId) : []
  return ok({ batchId, photoCount: files.length, started: jobIds.length }, 201)
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uploadedSchema = z.array(
  z.object({
    blobKey: z.string().min(1),
    mimeType: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteSize: z.number().int().positive(),
  }),
)

async function read(files: readonly File[]): Promise<UploadedFile[]> {
  const uploads: UploadedFile[] = []
  for (const file of files) {
    assertUploadSize(file.size)
    uploads.push({
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
    })
  }
  return uploads
}
