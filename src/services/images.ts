import sharp from 'sharp'
import { padBox, toPixelRect, type BoundingBox } from '@/domain/geometry'

export interface ImageMetadata {
  width: number
  height: number
  format: string
}

export class ImageProcessingError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message)
    this.name = 'ImageProcessingError'
  }
}

export async function readMetadata(data: Buffer): Promise<ImageMetadata> {
  try {
    const meta = await sharp(data).metadata()
    if (!meta.width || !meta.height) {
      throw new ImageProcessingError('Image has no readable dimensions')
    }
    return { width: meta.width, height: meta.height, format: meta.format ?? 'unknown' }
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error
    throw new ImageProcessingError('Could not read the image. Try a JPEG or PNG.', error)
  }
}

/** Context kept around a promoted detection. See `padBox` for why. */
export const CROP_PADDING = 0.08

export interface CropResult {
  data: Buffer
  width: number
  height: number
  contentType: string
}

/**
 * Cuts a detection's region out of the scene photo.
 *
 * This is what makes tap-to-promote feel instant: the new item already has a
 * usable picture of itself before the user has taken a single photo of it.
 * `.rotate()` runs first so EXIF orientation is baked in — without it, a crop
 * taken from a portrait phone photo lands on the wrong part of the image.
 */
export async function cropRegion(
  data: Buffer,
  bbox: BoundingBox,
  options: { padding?: number; maxEdge?: number } = {},
): Promise<CropResult> {
  const padding = options.padding ?? CROP_PADDING
  const maxEdge = options.maxEdge ?? 1600

  try {
    const oriented = sharp(data).rotate()
    const meta = await oriented.metadata()
    if (!meta.width || !meta.height) {
      throw new ImageProcessingError('Image has no readable dimensions')
    }

    const rect = toPixelRect(padBox(bbox, padding), meta.width, meta.height, 16)

    const output = await sharp(data)
      .rotate()
      .extract(rect)
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    return {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      contentType: 'image/jpeg',
    }
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error
    throw new ImageProcessingError('Could not crop the selected region', error)
  }
}

/**
 * Re-encodes an upload to a bounded JPEG.
 *
 * Phone cameras produce 12 MB, 4000px images. Detection gains nothing above
 * ~1600px and every extra megabyte is latency on a bad connection, so uploads
 * are normalized once on arrival and stored at a sane size.
 */
export async function normalizeUpload(
  data: Buffer,
  maxEdge = 2048,
): Promise<CropResult> {
  try {
    const output = await sharp(data)
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    return {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      contentType: 'image/jpeg',
    }
  } catch (error) {
    throw new ImageProcessingError(
      'Could not process that image. HEIC files may need to be converted to JPEG.',
      error,
    )
  }
}
