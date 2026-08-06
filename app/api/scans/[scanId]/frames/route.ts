import type { NextRequest } from 'next/server'
import { assertUploadSize, fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { addScanFrames, getScanDetail, type FrameUpload } from '@/services/scans'

type Params = { params: Promise<{ scanId: string }> }

/**
 * Receives keyframes extracted from a walkthrough video in the browser.
 *
 * Each frame arrives with the timestamp it was taken from and the sharpness
 * the client measured, so the review screen can order frames along the walk
 * and the user can tell which pass of the room a detection came from.
 */
export const POST = route(async (request: NextRequest, { params }: Params) => {
  const { scanId } = await params
  const { db, blobs } = getAppContext()

  const detail = await getScanDetail(db, scanId)
  if (!detail) return fail('not_found', 'That scan no longer exists.', 404)
  if (detail.scan.kind !== 'video') {
    return fail('conflict', 'Frames can only be added to a video scan.', 409)
  }

  const form = await request.formData()
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return fail('invalid_request', 'No frames were attached.', 422)
  }

  const timestamps = form.getAll('tMs').map((v) => Number(v))
  const sharpness = form.getAll('sharpness').map((v) => Number(v))

  const uploads: FrameUpload[] = []
  for (const [index, file] of files.entries()) {
    assertUploadSize(file.size)
    uploads.push({
      data: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
      tMs: Number.isFinite(timestamps[index]) ? timestamps[index]! : index * 1000,
      sharpness: Number.isFinite(sharpness[index]) ? sharpness[index] : undefined,
    })
  }

  const result = await addScanFrames(db, blobs, scanId, uploads)
  return ok(result, 201)
})
