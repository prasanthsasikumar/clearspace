import { boxArea, type BoundingBox } from './geometry'

/**
 * Cross-photo object grouping.
 *
 * The same chair photographed from the doorway, from the side, and again by
 * accident while aiming at the shelf behind it is one listing with three
 * views. Deciding which detections are the same physical object is the one
 * genuinely new problem the bulk-capture loop introduces.
 *
 * The model proposes the groups. This module enforces the parts that are
 * structural facts rather than judgements, repairs the ways a model reply can
 * be malformed, and never trusts the reply enough to lose a detection.
 *
 * Every function here is pure. The visual comparison lives behind the
 * `ObjectMatcher` port; this is the part that has to be right regardless of
 * which matcher is plugged in.
 */
export interface Groupable {
  id: string
  /** The photo this detection came from. Two from one photo are two objects. */
  scanId: string
  category: string | null
  label: string
  confidence: number | null
  bbox: BoundingBox
}

export interface ObjectGroup {
  members: Groupable[]
  /** The detection whose crop best represents the object. */
  representative: Groupable
  label: string
  category: string | null
}

/** Category buckets are chunked so no single matcher call gets unwieldy. */
export const DEFAULT_BUCKET_SIZE = 20

export interface Bucket {
  key: string
  members: Groupable[]
}

/**
 * Shards detections into comparison buckets.
 *
 * Only a chair is ever compared to a chair. This turns an O(n²) visual
 * comparison across the whole lot into small independent problems, costs
 * nothing, and makes the cross-category constraint structural rather than
 * something the model has to remember.
 *
 * Uncategorised detections share one bucket rather than being excluded — the
 * model failing to categorise something is no reason to strand it.
 */
export function bucketByCategory(
  detections: readonly Groupable[],
  maxBucketSize = DEFAULT_BUCKET_SIZE,
): Bucket[] {
  const byCategory = new Map<string, Groupable[]>()
  for (const detection of detections) {
    const key = detection.category ?? '__uncategorised__'
    const bucket = byCategory.get(key) ?? []
    bucket.push(detection)
    byCategory.set(key, bucket)
  }

  const buckets: Bucket[] = []
  for (const [key, members] of byCategory) {
    // A bucket of one has nothing to compare and needs no matcher call.
    for (let offset = 0; offset < members.length; offset += maxBucketSize) {
      buckets.push({ key, members: members.slice(offset, offset + maxBucketSize) })
    }
  }
  return buckets
}

/**
 * Enforces the one constraint the model cannot be trusted with: two detections
 * in the same photograph are two different objects.
 *
 * When a proposed group breaks that rule the model is wrong about at least one
 * member, and there is no honest way to know which. Rather than discard the
 * whole group — which throws away the correct pairings inside it — members are
 * dealt into the fewest slots that satisfy the constraint, first-fit. A group
 * of `a(photo1), b(photo1), c(photo2)` becomes `[a, c]` and `[b]`: still two
 * objects, still one of them carrying its second view.
 *
 * The bias is deliberate. Under-merging leaves a duplicate the user can see and
 * delete; over-merging makes an item silently vanish inside another one, and
 * nothing in the interface would reveal the loss.
 */
export function splitBySourcePhoto(group: readonly Groupable[]): Groupable[][] {
  const slots: Groupable[][] = []
  const slotScans: Set<string>[] = []

  for (const member of group) {
    let placed = false
    for (const [index, scans] of slotScans.entries()) {
      if (scans.has(member.scanId)) continue
      slots[index]!.push(member)
      scans.add(member.scanId)
      placed = true
      break
    }
    if (!placed) {
      slots.push([member])
      slotScans.push(new Set([member.scanId]))
    }
  }

  return slots
}

/**
 * Merges groups that share a member.
 *
 * Buckets are chunked, so one object can be proposed in two chunks. Union-find
 * over the shared members stitches those back together before items are made.
 */
export function mergeTransitive(groups: readonly (readonly string[])[]): string[][] {
  const parent = new Map<string, string>()

  const find = (id: string): string => {
    let root = parent.get(id) ?? id
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root
    // Path compression keeps repeated lookups flat on large lots.
    let cursor = id
    while (cursor !== root) {
      const next = parent.get(cursor) ?? cursor
      parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  const union = (a: string, b: string) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }

  const order: string[] = []
  for (const group of groups) {
    for (const id of group) {
      if (!parent.has(id)) {
        parent.set(id, id)
        order.push(id)
      }
    }
    for (let i = 1; i < group.length; i += 1) union(group[0]!, group[i]!)
  }

  const byRoot = new Map<string, string[]>()
  for (const id of order) {
    const root = find(id)
    const members = byRoot.get(root) ?? []
    members.push(id)
    byRoot.set(root, members)
  }

  return [...byRoot.values()]
}

/**
 * Turns a matcher's raw reply into groups that can be trusted.
 *
 * Model replies are malformed in predictable ways — ids that were never sent,
 * the same id in two groups, whole detections simply left out. Each is repaired
 * rather than treated as an error, because a bad reply must never cost the user
 * an object they photographed:
 *
 * - unknown ids are dropped
 * - a repeated id belongs to the group that claimed it first
 * - anything the model forgot becomes its own single-view object
 * - groups spanning one photo twice are split (see `splitBySourcePhoto`)
 */
export function applyGrouping(
  detections: readonly Groupable[],
  rawGroups: readonly (readonly string[])[],
): ObjectGroup[] {
  const byId = new Map(detections.map((d) => [d.id, d]))
  const claimed = new Set<string>()
  const accepted: Groupable[][] = []

  for (const rawGroup of mergeTransitive(rawGroups)) {
    const members: Groupable[] = []
    for (const id of rawGroup) {
      const detection = byId.get(id)
      if (!detection || claimed.has(id)) continue
      claimed.add(id)
      members.push(detection)
    }
    if (members.length === 0) continue
    accepted.push(...splitBySourcePhoto(members))
  }

  // Everything the matcher never mentioned still deserves to be an object.
  for (const detection of detections) {
    if (!claimed.has(detection.id)) accepted.push([detection])
  }

  return accepted.map(describeGroup).sort(byViewCountThenConfidence)
}

/**
 * Picks the crop that best represents the object and the name to call it.
 *
 * The representative is the most confident detection, breaking ties toward the
 * largest box — the view where the object fills the most frame is the one worth
 * showing on the listing card. The label is whichever name recurred most
 * across the views, which quietly corrects a single odd reading.
 */
export function describeGroup(members: readonly Groupable[]): ObjectGroup {
  const representative = [...members].sort((a, b) => {
    const byConfidence = (b.confidence ?? 0) - (a.confidence ?? 0)
    if (Math.abs(byConfidence) > 1e-9) return byConfidence
    return boxArea(b.bbox) - boxArea(a.bbox)
  })[0]!

  const counts = new Map<string, number>()
  for (const member of members) {
    counts.set(member.label, (counts.get(member.label) ?? 0) + 1)
  }
  let label = representative.label
  let best = 0
  for (const [candidate, count] of counts) {
    if (count > best) {
      best = count
      label = candidate
    }
  }

  return {
    members: [...members],
    representative,
    label,
    category: representative.category,
  }
}

/** Objects seen from several angles are the ones most worth selling. */
function byViewCountThenConfidence(a: ObjectGroup, b: ObjectGroup): number {
  const byViews = b.members.length - a.members.length
  if (byViews !== 0) return byViews
  return (b.representative.confidence ?? 0) - (a.representative.confidence ?? 0)
}
