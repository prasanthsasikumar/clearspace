import { NextResponse } from 'next/server'
import { z } from 'zod'
import { InvalidStatusTransitionError } from '@/domain/item-status'
import { ConflictError, NotFoundError } from '@/services/items'
import { ImageProcessingError } from '@/services/images'
import { VisionProviderError } from '@/ai/vision-provider'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export function ok<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status })
}

export function fail(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, details } }, { status })
}

/**
 * Maps a thrown error to a response.
 *
 * Domain errors carry messages written for the person holding the phone, so
 * they are passed through verbatim. Anything unrecognised is logged in full
 * and reported generically — an internal stack trace is not something a
 * marketplace app should hand to its client.
 */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof z.ZodError) {
    return fail('invalid_request', 'That request was not valid.', 422, error.issues)
  }
  if (error instanceof NotFoundError) {
    return fail('not_found', error.message, 404)
  }
  if (error instanceof ConflictError) {
    return fail('conflict', error.message, 409)
  }
  if (error instanceof InvalidStatusTransitionError) {
    return fail('invalid_transition', error.message, 409)
  }
  if (error instanceof ImageProcessingError) {
    return fail('bad_image', error.message, 422)
  }
  if (error instanceof VisionProviderError) {
    return fail('vision_unavailable', 'Image analysis is unavailable right now.', 503)
  }

  console.error('[api] unhandled error', error)
  return fail('internal_error', 'Something went wrong on our end.', 500)
}

/** Wraps a handler so every route shares one error contract. */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args)
    } catch (error) {
      return toErrorResponse(error)
    }
  }
}

export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    throw new z.ZodError([
      {
        code: 'custom',
        path: [],
        message: 'Expected a JSON body.',
      },
    ])
  }
  return schema.parse(payload)
}

export const uuidSchema = z.string().uuid('Expected an id.')

/** Uploads are capped well above a phone photo but below a denial of service. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export function assertUploadSize(bytes: number): void {
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new ImageProcessingError(
      `That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    )
  }
}
