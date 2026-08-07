import { scoreQuality } from '@/domain/image-quality'
import type { PhotoQuality } from '@/domain/types'

export interface PreparedImage {
  file: File
  width: number
  height: number
  quality: PhotoQuality
  previewUrl: string
}

const MAX_EDGE = 2048
/** Sharpness is measured on a small copy; the kernel is O(pixels). */
const ANALYSIS_EDGE = 320

/**
 * Prepares a camera file for upload.
 *
 * Everything here happens before a single byte goes over the wire, which is
 * the point: a storage unit has one bar of signal, and re-encoding an 12 MB
 * HEIC to a 400 KB JPEG on-device turns a 40-second upload into a 2-second
 * one. Decoding through the browser also solves HEIC: iOS decodes its own
 * format natively, so the server only ever sees JPEG.
 */
export async function prepareImage(file: File, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  const bitmap = await decode(file)

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable in this browser.')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const quality = measureQuality(bitmap)
    const blob = await toJpeg(canvas, 0.86)

    return {
      file: new File([blob], renameToJpeg(file.name), { type: 'image/jpeg' }),
      width,
      height,
      quality,
      previewUrl: URL.createObjectURL(blob),
    }
  } finally {
    bitmap.close?.()
  }
}

/**
 * Scores sharpness and exposure from a downscaled greyscale copy.
 *
 * Variance of the Laplacian is the standard cheap blur measure: a sharp image
 * has strong second derivatives at edges, a blurred one does not. Measuring on
 * a 320 px copy keeps it under a frame's budget so the result can be shown the
 * instant the shutter closes.
 */
export function measureQuality(source: CanvasImageSource & { width: number; height: number }): PhotoQuality {
  const scale = Math.min(1, ANALYSIS_EDGE / Math.max(source.width, source.height))
  const w = Math.max(3, Math.round(source.width * scale))
  const h = Math.max(3, Math.round(source.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { blurScore: 1, exposure: 0.5, issues: [] }
  }
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const grey = new Float32Array(w * h)
  let luminanceSum = 0
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // Rec. 601 luma: matches how the eye weights the channels.
    const value =
      0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
    grey[p] = value
    luminanceSum += value
  }

  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x
      const laplacian =
        4 * (grey[i] ?? 0) -
        (grey[i - 1] ?? 0) -
        (grey[i + 1] ?? 0) -
        (grey[i - w] ?? 0) -
        (grey[i + w] ?? 0)
      sum += laplacian
      sumSquares += laplacian * laplacian
      count += 1
    }
  }

  const mean = count > 0 ? sum / count : 0
  const variance = count > 0 ? sumSquares / count - mean * mean : 0

  return scoreQuality({
    laplacianVariance: variance,
    meanLuminance: luminanceSum / (w * h) / 255,
    width: source.width,
    height: source.height,
  })
}

/** Raw sharpness, for ranking video frames against one another. */
export function measureSharpness(
  source: CanvasImageSource & { width: number; height: number },
): number {
  return measureQuality(source).blurScore
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    throw new Error(
      `Could not read ${file.name || 'that file'}. Try taking the photo as a JPEG.`,
      { cause: error },
    )
  }
}

export function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))),
      'image/jpeg',
      quality,
    )
  })
}

function renameToJpeg(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'photo'
  return `${base}.jpg`
}
