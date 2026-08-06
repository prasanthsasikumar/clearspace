import type { NextRequest } from 'next/server'
import { assertUploadSize, fail, ok, route } from '@/server/api'
import { photoQualityInputSchema, photoViewSchema } from '@/server/schemas'
import { getAppContext } from '@/server/context'
import { addItemPhoto, getItemDetail } from '@/services/items'

type Params = { params: Promise<{ itemId: string }> }

/**
 * Adds a photo to an item.
 *
 * The client sends the sharpness and exposure it measured on-device alongside
 * the file. Those are real measurements taken before the image was compressed,
 * so they are stored as given; the server-side model pass only adds judgement
 * about the subject on top.
 */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { itemId } = await params
  const { db, blobs } = getAppContext()

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return fail('invalid_request', 'No photo was attached.', 422)
  }
  assertUploadSize(file.size)

  const view = photoViewSchema.parse(String(form.get('view') ?? 'other'))

  const rawQuality = form.get('quality')
  let quality: unknown
  if (typeof rawQuality === 'string' && rawQuality.length > 0) {
    const parsed = photoQualityInputSchema.safeParse(JSON.parse(rawQuality))
    if (parsed.success) quality = parsed.data
  }

  const photo = await addItemPhoto(db, blobs, itemId, {
    data: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type || 'image/jpeg',
    view,
    quality,
  })

  const detail = await getItemDetail(db, itemId)
  return ok({ photo, coverage: detail?.coverage ?? null }, 201)
})
