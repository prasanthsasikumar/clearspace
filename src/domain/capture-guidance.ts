import type { ScanKind } from '@/db/schema'

export interface CaptureMode {
  kind: ScanKind
  title: string
  blurb: string
  /** Ordered coaching steps shown before and during capture. */
  steps: string[]
  accept: string
  multiple: boolean
}

/**
 * The coaching copy for the capture screen.
 *
 * Detection quality is decided before a single byte reaches the model. A photo
 * taken from the doorway of a storage unit yields boxes too small to tap and
 * labels too vague to sell; one taken from three feet in, with the door open
 * for light, yields a usable inventory. So the app tells people that up front
 * rather than silently returning worse results.
 */
export const captureModes: readonly CaptureMode[] = [
  {
    kind: 'scene',
    title: 'Scan a room',
    blurb: 'One wide photo. Sorta finds every sellable item in it.',
    steps: [
      'Open the door and let in as much light as you can.',
      'Stand back far enough to get a whole wall in frame.',
      'Keep the camera level — angled shots hide what is behind things.',
      'Shoot one wall at a time rather than one photo of everything.',
    ],
    accept: 'image/*',
    multiple: false,
  },
  {
    kind: 'photo',
    title: 'Multiple photos',
    blurb: 'Several photos at once — one per shelf, corner, or pile.',
    steps: [
      'Work around the space in order so you do not miss a corner.',
      'Move closer for shelves and bins; small items need the frame.',
      'Overlap each shot slightly with the last.',
    ],
    accept: 'image/*',
    multiple: true,
  },
  {
    kind: 'video',
    title: 'Video walkthrough',
    blurb: 'Walk the space once. Sorta pulls the sharp frames out.',
    steps: [
      'Walk slowly — about one step every two seconds.',
      'Pause two seconds on anything worth money.',
      'Sweep low and high; the top shelf is where the good stuff hides.',
      'Thirty to sixty seconds is plenty.',
    ],
    accept: 'video/*',
    multiple: false,
  },
]

export function captureModeFor(kind: ScanKind): CaptureMode {
  const mode = captureModes.find((m) => m.kind === kind)
  if (!mode) throw new Error(`Unknown capture mode: ${kind}`)
  return mode
}

/**
 * Coaching shown after detection, based on what came back. An empty result is
 * usually a framing problem, not a model failure, and saying so is far more
 * useful than "no objects found".
 */
export function detectionFeedback(count: number): string | null {
  if (count === 0) {
    return 'Nothing found. Try moving closer, adding light, or shooting one wall at a time.'
  }
  if (count === 1) {
    return 'Only one item found. If there is more in the room, take a wider shot or scan the next wall.'
  }
  if (count >= 20) {
    return 'Lots found. Promote the ones worth selling and dismiss the rest — you can rescan any wall in more detail.'
  }
  return null
}
