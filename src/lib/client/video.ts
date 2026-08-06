import { measureQuality, toJpeg } from './image'

export interface Keyframe {
  blob: Blob
  tMs: number
  sharpness: number
  previewUrl: string
}

export interface ExtractOptions {
  /** How many frames to keep. Each becomes one detection call. */
  maxFrames?: number
  /** Frames closer together than this are near-duplicates of one another. */
  minGapMs?: number
  onProgress?: (done: number, total: number) => void
}

const FRAME_EDGE = 1600
const BLUR_FLOOR = 0.2

/**
 * Pulls usable stills out of a walkthrough video, entirely in the browser.
 *
 * Doing this client-side is what lets Sorta accept video at all without an
 * ffmpeg dependency on the server. It also means a 60-second, 90 MB walkthrough
 * never leaves the phone — only the eight or so frames worth analysing do.
 *
 * Frames are sampled evenly, then filtered twice: anything below the blur floor
 * is dropped (walking motion smears most frames), and anything too similar to
 * the frame before it is dropped as well, because paying for detection on the
 * same shelf twice helps nobody.
 */
export async function extractKeyframes(
  file: File,
  options: ExtractOptions = {},
): Promise<Keyframe[]> {
  const maxFrames = options.maxFrames ?? 8
  const minGapMs = options.minGapMs ?? 1200

  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  const objectUrl = URL.createObjectURL(file)
  video.src = objectUrl

  try {
    await once(video, 'loadedmetadata')
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('That video has no readable duration.')
    }

    // Sample more positions than we keep, so the blur filter has somewhere to
    // fall back to when a stretch of the walk is smeared.
    const sampleCount = Math.min(maxFrames * 2, Math.max(4, Math.floor(duration)))
    const candidates: Keyframe[] = []

    for (let i = 0; i < sampleCount; i += 1) {
      const t = ((i + 0.5) / sampleCount) * duration
      await seekTo(video, t)

      const scale = Math.min(1, FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.max(1, Math.round(video.videoWidth * scale))
      const height = Math.max(1, Math.round(video.videoHeight * scale))

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is unavailable in this browser.')
      ctx.drawImage(video, 0, 0, width, height)

      const quality = measureQuality(canvas)
      const blob = await toJpeg(canvas, 0.85)
      candidates.push({
        blob,
        tMs: Math.round(t * 1000),
        sharpness: quality.blurScore,
        previewUrl: URL.createObjectURL(blob),
      })

      options.onProgress?.(i + 1, sampleCount)
    }

    return selectFrames(candidates, maxFrames, minGapMs)
  } finally {
    URL.revokeObjectURL(objectUrl)
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * Keeps the sharpest frames while enforcing a minimum spacing along the walk.
 * Greedy by sharpness rather than uniform by time: one crisp frame of a shelf
 * beats three smeared ones, and the spacing rule stops the whole budget being
 * spent on the two seconds where the user stood still.
 */
export function selectFrames(
  candidates: readonly Keyframe[],
  maxFrames: number,
  minGapMs: number,
): Keyframe[] {
  const usable = candidates.filter((frame) => frame.sharpness >= BLUR_FLOOR)
  const pool = usable.length > 0 ? usable : [...candidates]
  const ranked = [...pool].sort((a, b) => b.sharpness - a.sharpness)

  const kept: Keyframe[] = []
  for (const frame of ranked) {
    if (kept.length >= maxFrames) break
    if (kept.some((k) => Math.abs(k.tMs - frame.tMs) < minGapMs)) continue
    kept.push(frame)
  }

  return kept.sort((a, b) => a.tMs - b.tMs)
}

function once(target: HTMLVideoElement, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDone = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not read that video.'))
    }
    const cleanup = () => {
      target.removeEventListener(event, onDone)
      target.removeEventListener('error', onError)
    }
    target.addEventListener(event, onDone, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Could not seek that video.'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = Math.min(seconds, Math.max(0, video.duration - 0.05))
  })
}
