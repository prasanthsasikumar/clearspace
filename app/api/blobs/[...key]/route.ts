import { NextResponse, type NextRequest } from 'next/server'
import { fail, route } from '@/server/api'
import { getAppContext } from '@/server/context'

type Params = { params: Promise<{ key: string[] }> }

/**
 * Serves stored images.
 *
 * Keys are validated by the store before they touch the filesystem, so a
 * crafted path cannot walk out of the storage root. Blobs are immutable once
 * written (the key contains a UUID), so they are cached aggressively.
 */
export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { key } = await params
  const { blobs } = getAppContext()

  let blob
  try {
    blob = await blobs.get(key.join('/'))
  } catch {
    return fail('invalid_request', 'That is not a valid image reference.', 400)
  }

  if (!blob) return fail('not_found', 'That image no longer exists.', 404)

  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      'Content-Type': blob.contentType,
      'Content-Length': String(blob.data.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  })
})
