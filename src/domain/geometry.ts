/**
 * The single coordinate contract in Clearspace.
 *
 * Every bounding box, whether it came from Gemini, a future SAM 2 adapter, or
 * a finger dragged across a canvas, is stored and passed around as normalized
 * fractions of the image dimensions, origin top-left, y growing downward.
 *
 * Keeping boxes resolution-independent means the same row survives a thumbnail,
 * a full-resolution crop, and a re-render at any zoom level without conversion
 * bugs. Pixels only exist at the two edges of the system: the crop service and
 * the canvas renderer.
 */
export interface BoundingBox {
  x: number
  y: number
  w: number
  h: number
}

/** Integer pixel rectangle, the form `sharp` and `canvas` both want. */
export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

const EPSILON = 1e-9

export function isValidBox(box: BoundingBox): boolean {
  const finite = [box.x, box.y, box.w, box.h].every(Number.isFinite)
  if (!finite) return false
  if (box.w <= EPSILON || box.h <= EPSILON) return false
  if (box.x < -EPSILON || box.y < -EPSILON) return false
  if (box.x + box.w > 1 + EPSILON) return false
  if (box.y + box.h > 1 + EPSILON) return false
  return true
}

/** Clamps a box into the unit square, preserving as much of it as possible. */
export function clampBox(box: BoundingBox): BoundingBox {
  const x1 = Math.min(Math.max(box.x, 0), 1)
  const y1 = Math.min(Math.max(box.y, 0), 1)
  const x2 = Math.min(Math.max(box.x + box.w, 0), 1)
  const y2 = Math.min(Math.max(box.y + box.h, 0), 1)
  return { x: x1, y: y1, w: Math.max(x2 - x1, 0), h: Math.max(y2 - y1, 0) }
}

/**
 * Gemini returns boxes as `[ymin, xmin, ymax, xmax]` integers scaled to 0-1000,
 * regardless of the source image's aspect ratio. This is the only place that
 * format is understood; everything downstream sees a `BoundingBox`.
 */
export function boxFromGemini(
  coords: readonly number[],
  scale = 1000,
): BoundingBox | null {
  if (coords.length !== 4) return null
  const [ymin, xmin, ymax, xmax] = coords as [number, number, number, number]
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null

  // The model occasionally emits reversed pairs; ordering them is cheaper than
  // discarding an otherwise good detection.
  const box = clampBox({
    x: Math.min(xmin, xmax) / scale,
    y: Math.min(ymin, ymax) / scale,
    w: Math.abs(xmax - xmin) / scale,
    h: Math.abs(ymax - ymin) / scale,
  })
  return isValidBox(box) ? box : null
}

/**
 * Grows a box by `pad` (as a fraction of the box's own size) then clamps.
 * Crops carry a little surrounding context on purpose: an object cut exactly
 * at its silhouette reads as a sticker, and downstream identification does
 * better with a hint of the surface an item is sitting on.
 */
export function padBox(box: BoundingBox, pad: number): BoundingBox {
  const dx = box.w * pad
  const dy = box.h * pad
  return clampBox({
    x: box.x - dx,
    y: box.y - dy,
    w: box.w + dx * 2,
    h: box.h + dy * 2,
  })
}

/**
 * Converts to integer pixels for cropping. Guarantees a rectangle at least
 * `minSize` px on each side and fully inside the image, so `sharp.extract`
 * can never be handed a zero-width or out-of-bounds region.
 */
export function toPixelRect(
  box: BoundingBox,
  imageWidth: number,
  imageHeight: number,
  minSize = 8,
): PixelRect {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error(`Invalid image dimensions: ${imageWidth}x${imageHeight}`)
  }
  const clamped = clampBox(box)

  const cappedMinW = Math.min(minSize, imageWidth)
  const cappedMinH = Math.min(minSize, imageHeight)

  let width = Math.max(Math.round(clamped.w * imageWidth), cappedMinW)
  let height = Math.max(Math.round(clamped.h * imageHeight), cappedMinH)
  width = Math.min(width, imageWidth)
  height = Math.min(height, imageHeight)

  const left = Math.min(Math.max(Math.round(clamped.x * imageWidth), 0), imageWidth - width)
  const top = Math.min(Math.max(Math.round(clamped.y * imageHeight), 0), imageHeight - height)

  return { left, top, width, height }
}

export function boxArea(box: BoundingBox): number {
  return Math.max(box.w, 0) * Math.max(box.h, 0)
}

/** Intersection over union, the standard duplicate-detection measure. */
export function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)

  const overlap = Math.max(x2 - x1, 0) * Math.max(y2 - y1, 0)
  if (overlap <= 0) return 0

  const union = boxArea(a) + boxArea(b) - overlap
  return union <= 0 ? 0 : overlap / union
}

export interface DedupeCandidate {
  bbox: BoundingBox
  confidence?: number | null
  label?: string
}

/**
 * Non-maximum suppression over detections.
 *
 * Vision models routinely return the same chair three times: as "chair",
 * "office chair", and "furniture". Showing all three turns the review screen
 * into a game of whack-a-mole, so overlapping boxes collapse to the most
 * confident one. Ties break toward the larger box, which is more likely to
 * contain the whole object rather than a part of it.
 */
export function suppressOverlapping<T extends DedupeCandidate>(
  candidates: readonly T[],
  threshold = 0.6,
): T[] {
  const ranked = [...candidates].sort((a, b) => {
    const byConfidence = (b.confidence ?? 0) - (a.confidence ?? 0)
    if (Math.abs(byConfidence) > EPSILON) return byConfidence
    return boxArea(b.bbox) - boxArea(a.bbox)
  })

  const kept: T[] = []
  for (const candidate of ranked) {
    if (kept.some((k) => iou(k.bbox, candidate.bbox) >= threshold)) continue
    kept.push(candidate)
  }
  return kept
}

/**
 * Builds a box from two drag endpoints in normalized space, in any order.
 * Used by the draw-a-missed-object gesture on the review canvas.
 */
export function boxFromDrag(
  start: { x: number; y: number },
  end: { x: number; y: number },
): BoundingBox {
  return clampBox({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  })
}

export function boxContains(box: BoundingBox, point: { x: number; y: number }): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.w &&
    point.y >= box.y &&
    point.y <= box.y + box.h
  )
}

/**
 * Which box did the user mean to tap? Boxes nest constantly (a toolbox sits
 * inside a shelving unit), so a tap inside several boxes resolves to the
 * smallest, which is the one whose edges are nearest the finger.
 */
export function pickBoxAt<T extends { bbox: BoundingBox }>(
  candidates: readonly T[],
  point: { x: number; y: number },
): T | null {
  let best: T | null = null
  for (const candidate of candidates) {
    if (!boxContains(candidate.bbox, point)) continue
    if (best === null || boxArea(candidate.bbox) < boxArea(best.bbox)) {
      best = candidate
    }
  }
  return best
}
