import type { PhotoIssue, PhotoQuality } from './types'

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

export interface QualityMeasurements {
  /** Variance of the Laplacian over the greyscale image. Higher is sharper. */
  laplacianVariance: number
  /** Mean luminance, 0-1. */
  meanLuminance: number
  width: number
  height: number
}

/**
 * Thresholds, chosen against phone photos taken in the conditions this app
 * actually runs in: a storage unit lit by one bulb, a garage at dusk, a
 * driveway in direct sun.
 */
const BLUR_VARIANCE_CEILING = 400
const BLUR_ISSUE_THRESHOLD = 0.25
const DARK_THRESHOLD = 0.22
const BRIGHT_THRESHOLD = 0.82
const MIN_USABLE_EDGE = 640

/**
 * Scores a photo from cheap measurements taken on-device.
 *
 * This runs in the browser the instant the shutter fires, so a blurry photo is
 * caught before it is uploaded, which matters a great deal when the seller is
 * standing in a concrete box with one bar of signal. Gemini's richer judgement
 * (is the serial number actually legible?) runs afterwards, server-side.
 */
export function scoreQuality(measurements: QualityMeasurements): PhotoQuality {
  const blurScore = clamp01(measurements.laplacianVariance / BLUR_VARIANCE_CEILING)
  const exposure = clamp01(measurements.meanLuminance)
  const shortEdge = Math.min(measurements.width, measurements.height)

  const issues: PhotoIssue[] = []
  if (blurScore < BLUR_ISSUE_THRESHOLD) issues.push('blurry')
  if (exposure < DARK_THRESHOLD) issues.push('too_dark')
  if (exposure > BRIGHT_THRESHOLD) issues.push('too_bright')
  if (shortEdge > 0 && shortEdge < MIN_USABLE_EDGE) issues.push('low_resolution')

  return { blurScore, exposure, issues }
}

/** A photo with no issues is safe to count toward coverage. */
export function isUsable(quality: PhotoQuality | null | undefined): boolean {
  if (!quality) return true
  return !quality.issues.includes('blurry') && !quality.issues.includes('too_dark')
}

const ISSUE_ADVICE: Record<PhotoIssue, string> = {
  blurry: 'Hold still and tap the item to focus, then shoot again.',
  too_dark: 'Turn on a light or move the item toward the door.',
  too_bright: 'Step out of direct sun. The details are blown out.',
  low_resolution: 'Use the main camera at full resolution.',
  obstructed: 'Something is in the way. Move it and reshoot.',
  too_far: 'Move closer so the item fills most of the frame.',
}

/** The single most useful thing to tell the user about a photo. */
export function adviceFor(quality: PhotoQuality | null | undefined): string | null {
  const issue = quality?.issues[0]
  return issue ? ISSUE_ADVICE[issue] : null
}
