import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { detections, itemPhotos, items, scans, type Item } from '@/db/schema'
import {
  applyGrouping,
  bucketByCategory,
  type Groupable,
  type ObjectGroup,
} from '@/domain/grouping'
import { isItemCategory } from '@/domain/types'
import { noMatches, type MatchCandidate, type ObjectMatcher } from '@/ai/object-matcher'
import type { BlobStore } from '@/storage'
import { enqueue } from '@/jobs/queue'
import { touchLot } from './lots'

export interface GroupingResult {
  detectionsConsidered: number
  itemsCreated: number
  /** How many items ended up with more than one view. */
  multiViewItems: number
}

/**
 * Turns every un-promoted detection in a batch into inventory.
 *
 * This is the pivot's core: the user photographed a space and gets items back
 * without tapping anything. The matcher decides which crops show the same
 * object; `domain/grouping` decides how much of that answer to believe.
 *
 * Detections already promoted or dismissed are skipped, which makes the whole
 * operation safe to run twice: a duplicate grouping job finds nothing left to
 * assign and does nothing.
 */
export async function groupBatchIntoItems(
  db: Database,
  blobs: BlobStore,
  matcher: ObjectMatcher,
  input: { batchId: string; lotId: string },
): Promise<GroupingResult> {
  const rows = await db
    .select({ detection: detections })
    .from(detections)
    .innerJoin(scans, eq(scans.id, detections.scanId))
    .where(
      and(
        eq(scans.batchId, input.batchId),
        isNull(detections.promotedItemId),
        isNull(detections.dismissedAt),
      ),
    )

  const pending = rows.map((row) => row.detection)
  if (pending.length === 0) {
    return { detectionsConsidered: 0, itemsCreated: 0, multiViewItems: 0 }
  }

  const groupable: Groupable[] = pending.map((d) => ({
    id: d.id,
    scanId: d.scanId,
    category: d.category,
    label: d.label,
    confidence: d.confidence,
    bbox: d.bbox,
  }))

  const cropByDetection = new Map(
    pending.filter((d) => d.cropBlobKey).map((d) => [d.id, d.cropBlobKey!]),
  )

  const rawGroups = await proposeGroups(blobs, matcher, groupable, cropByDetection)
  const groups = applyGrouping(groupable, rawGroups)

  const createdIds: string[] = []
  for (const group of groups) {
    const item = await createItemFromGroup(db, input.lotId, group, cropByDetection)
    createdIds.push(item.id)
  }

  /*
   * Write every item up as soon as it exists.
   *
   * This used to wait to be asked, on the reasoning that researching sixty
   * listings when the seller only means to sell twelve is money spent on
   * forty-eight they were going to bin anyway. The cost is real, and it was
   * the wrong trade: it left the board full of cards saying "Not yet priced"
   * with nothing explaining that a price was something you had to go and ask
   * for, so the export produced an empty file and the seller had no idea why.
   *
   * An estimate that arrives on its own can be changed by anyone who
   * disagrees with it. One that has to be requested is one nobody knows to
   * request.
   *
   * One job for the lot rather than one per item. Every item on a single
   * numbered sheet is one model call instead of fifty, which is the
   * difference between a board that fills in while you look at it and one you
   * wait minutes for.
   */
  if (createdIds.length > 0) {
    await enqueue(db, 'enrich_lot', { lotId: input.lotId })
  }

  const created = createdIds.length
  await touchLot(db, input.lotId)

  return {
    detectionsConsidered: pending.length,
    itemsCreated: created,
    multiViewItems: groups.filter((g) => g.members.length > 1).length,
  }
}

/**
 * Asks the matcher about each category bucket in turn.
 *
 * A bucket that fails falls back to "everything here is its own object" rather
 * than aborting the batch. Half a grouped inventory beats none, and the failure
 * direction is the safe one: the user sees duplicates instead of losing items.
 */
async function proposeGroups(
  blobs: BlobStore,
  matcher: ObjectMatcher,
  groupable: readonly Groupable[],
  cropByDetection: ReadonlyMap<string, string>,
): Promise<string[][]> {
  const proposed: string[][] = []

  for (const bucket of bucketByCategory(groupable)) {
    const candidates: MatchCandidate[] = []
    for (const member of bucket.members) {
      const key = cropByDetection.get(member.id)
      if (!key) continue
      const blob = await blobs.get(key)
      if (!blob) continue
      candidates.push({
        id: member.id,
        label: member.label,
        image: { data: blob.data, mimeType: blob.contentType },
      })
    }

    if (candidates.length < 2) {
      proposed.push(...noMatches(candidates))
      continue
    }

    try {
      proposed.push(
        ...(await matcher.matchObjects({
          candidates,
          categoryHint: bucket.key === '__uncategorised__' ? undefined : bucket.key,
        })),
      )
    } catch (error) {
      console.error(`[grouping] matcher failed on bucket "${bucket.key}"`, error)
      proposed.push(...noMatches(candidates))
    }
  }

  return proposed
}

/**
 * Creates one item and hangs every view of the object off it.
 *
 * The representative's crop becomes the primary photo (the one that shows on
 * the listing card), and the rest follow in the order they were grouped. Views
 * are tagged `other` rather than guessed at: an automatic crop is a picture of
 * the object, not a considered front-on listing photo, and the shot list should
 * still ask for those.
 */
async function createItemFromGroup(
  db: Database,
  lotId: string,
  group: ObjectGroup,
  cropByDetection: ReadonlyMap<string, string>,
): Promise<Item> {
  const [item] = await db
    .insert(items)
    .values({
      lotId,
      title: toTitle(group.label),
      category: group.category && isItemCategory(group.category) ? group.category : null,
      status: 'needs_confirmation',
      createdFromDetectionId: group.representative.id,
    })
    .returning()

  if (!item) throw new Error('Failed to create item')

  const ordered = [
    group.representative,
    ...group.members.filter((m) => m.id !== group.representative.id),
  ]

  let isFirst = true
  for (const member of ordered) {
    const key = cropByDetection.get(member.id)
    if (!key) continue
    await db.insert(itemPhotos).values({
      itemId: item.id,
      blobKey: key,
      sourceDetectionId: member.id,
      view: 'other',
      isPrimary: isFirst,
    })
    isFirst = false
  }

  await db
    .update(detections)
    .set({ promotedItemId: item.id })
    .where(
      inArray(
        detections.id,
        group.members.map((m) => m.id),
      ),
    )

  return item
}

function toTitle(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length === 0) return 'Untitled item'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
