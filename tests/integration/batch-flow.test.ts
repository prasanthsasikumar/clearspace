import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { createHarness, drainJobs, makeJpeg, type Harness } from '../helpers/harness'
import { FixtureVisionProvider } from '@/ai/fixture-provider'
import { FixtureObjectMatcher, groupByLabel } from '@/ai/fixture-matcher'
import { detections as detectionsTable, itemPhotos, items, scans } from '@/db/schema'
import type { DetectedObject } from '@/domain/types'
import { createBatch, getBatchProgress } from '@/services/batches'
import { createLot } from '@/services/lots'
import { getItemDetail, listItems } from '@/services/items'
import { getCurrentUser } from '@/services/user'

/**
 * The bulk loop end to end: a pile of photos in, grouped listings out.
 *
 * The vision provider and matcher are recorded rather than mocked, and the
 * matcher used here (group everything sharing a label) is deliberately the
 * worst plausible one: it merges every chair in the lot into a single object.
 * If the guard rails hold against that, they hold against a real model having
 * an off day.
 */
describe('bulk batch → grouped listings', () => {
  let harness: Harness
  let lotId: string

  beforeEach(async () => {
    harness = await createHarness()
    const user = await getCurrentUser(harness.db)
    const lot = await createLot(harness.db, user.id, {
      name: 'Storage Unit #23',
      kind: 'storage_unit',
    })
    lotId = lot.id
  })

  afterEach(async () => {
    await harness.close()
  })

  async function uploadPhotos(count: number, h: Harness = harness, lot = lotId) {
    const files = []
    for (let i = 0; i < count; i += 1) {
      files.push({ data: await makeJpeg(1200, 900), mimeType: 'image/jpeg' })
    }
    const batch = await createBatch(h.db, h.blobs, { lotId: lot, files })
    await drainJobs(h)
    return batch
  }

  it('creates one listing per object rather than one per photo', async () => {
    // Three photos, each yielding the same eight recorded detections. A user
    // walking a unit shooting the same shelf three times must not end up with
    // twenty-four listings.
    const batch = await uploadPhotos(3)

    const created = await listItems(harness.db, lotId)
    expect(created).toHaveLength(8)

    const progress = await getBatchProgress(harness.db, batch.batchId)
    expect(progress!.phase).toBe('complete')
    expect(progress!.photoCount).toBe(3)
    expect(progress!.detectionCount).toBe(24)
    expect(progress!.itemCount).toBe(8)
    expect(progress!.multiViewItems).toBe(8)
  })

  /*
   * The board used to fill with cards reading "Not yet priced", and nothing on
   * it said a price was something you had to go and ask for. Every symptom
   * traced back here: the export produced an empty file, an approved item
   * claimed it was ready, and the seller had no way to know why. An estimate
   * that arrives on its own can be disagreed with; one that has to be
   * requested is one nobody knows to request.
   */
  it('writes up and prices every item it creates, without being asked', async () => {
    await uploadPhotos(3)

    const created = await listItems(harness.db, lotId)
    expect(created).toHaveLength(8)

    for (const item of created) {
      expect(item.estimatedValueCents).not.toBeNull()
      expect(item.estimatedValueCents!).toBeGreaterThan(0)
    }

    // Written up, not merely priced: the description is what the seller pastes
    // into Marketplace, and the export carries it.
    const detail = await getItemDetail(harness.db, created[0]!.id)
    expect(detail!.item.status).not.toBe('needs_confirmation')
  })

  it('hangs every view of an object off its listing', async () => {
    await uploadPhotos(3)

    const created = await listItems(harness.db, lotId)
    const chair = created.find((item) => item.title.includes('chair'))!
    const detail = await getItemDetail(harness.db, chair.id)

    expect(detail!.photos).toHaveLength(3)
    expect(detail!.photos.filter((p) => p.isPrimary)).toHaveLength(1)
    // Each view traces back to the crop and photo it came from.
    for (const photo of detail!.photos) {
      expect(photo.sourceDetectionId).toBeTruthy()
      expect(await harness.blobs.get(photo.blobKey)).not.toBeNull()
    }
    const sourceScans = new Set(
      (
        await harness.db
          .select({ scanId: detectionsTable.scanId })
          .from(detectionsTable)
          .where(
            inArray(
              detectionsTable.id,
              detail!.photos.map((p) => p.sourceDetectionId!),
            ),
          )
      ).map((r) => r.scanId),
    )
    expect(sourceScans.size).toBe(3)
  })

  it('keeps two identical objects in one photo apart', async () => {
    // The hardest case in a storage unit: matching furniture. The matcher will
    // happily merge these; the same-photo rule is what saves them.
    const twinChairs: DetectedObject[] = [
      {
        label: 'dining chair',
        category: 'furniture',
        bbox: { x: 0.05, y: 0.2, w: 0.2, h: 0.5 },
        confidence: 0.9,
      },
      {
        label: 'dining chair',
        category: 'furniture',
        bbox: { x: 0.4, y: 0.2, w: 0.2, h: 0.5 },
        confidence: 0.88,
      },
    ]

    const twins = await createHarness({
      vision: new FixtureVisionProvider({ detections: twinChairs }),
    })
    try {
      const user = await getCurrentUser(twins.db)
      const lot = await createLot(twins.db, user.id, { name: 'Dining room', kind: 'home' })
      await uploadPhotos(1, twins, lot.id)

      const created = await listItems(twins.db, lot.id)
      expect(created).toHaveLength(2)
      for (const item of created) {
        const detail = await getItemDetail(twins.db, item.id)
        expect(detail!.photos).toHaveLength(1)
      }
    } finally {
      await twins.close()
    }
  })

  it('pairs matching objects across photos without merging them together', async () => {
    const twinChairs: DetectedObject[] = [
      {
        label: 'dining chair',
        category: 'furniture',
        bbox: { x: 0.05, y: 0.2, w: 0.2, h: 0.5 },
        confidence: 0.9,
      },
      {
        label: 'dining chair',
        category: 'furniture',
        bbox: { x: 0.4, y: 0.2, w: 0.2, h: 0.5 },
        confidence: 0.88,
      },
    ]

    const twins = await createHarness({
      vision: new FixtureVisionProvider({ detections: twinChairs }),
    })
    try {
      const user = await getCurrentUser(twins.db)
      const lot = await createLot(twins.db, user.id, { name: 'Dining room', kind: 'home' })
      await uploadPhotos(2, twins, lot.id)

      // Two chairs seen in two photos is two listings with two views each,
      // not one listing with four, and not four listings with one.
      const created = await listItems(twins.db, lot.id)
      expect(created).toHaveLength(2)
      for (const item of created) {
        const detail = await getItemDetail(twins.db, item.id)
        expect(detail!.photos).toHaveLength(2)
      }
    } finally {
      await twins.close()
    }
  })

  it('marks every detection as belonging to the item it produced', async () => {
    await uploadPhotos(2)

    const batchScans = await harness.db
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.lotId, lotId))
    const rows = await harness.db
      .select()
      .from(detectionsTable)
      .where(
        inArray(
          detectionsTable.scanId,
          batchScans.map((s) => s.id),
        ),
      )

    expect(rows.length).toBeGreaterThan(0)
    for (const detection of rows) {
      expect(detection.promotedItemId).not.toBeNull()
      expect(detection.cropBlobKey).not.toBeNull()
    }
  })

  it('falls back to one object per crop when the matcher fails', async () => {
    const broken = await createHarness({
      matcher: new FixtureObjectMatcher(groupByLabel, new Error('matcher unavailable')),
    })
    try {
      const user = await getCurrentUser(broken.db)
      const lot = await createLot(broken.db, user.id, { name: 'Garage', kind: 'garage' })
      await uploadPhotos(2, broken, lot.id)

      // Duplicates the user can see and bin, rather than a failed batch or,
      // far worse, items silently merged away.
      const created = await listItems(broken.db, lot.id)
      expect(created).toHaveLength(16)
    } finally {
      await broken.close()
    }
  })

  it('is safe to group twice', async () => {
    const batch = await uploadPhotos(2)
    const before = await listItems(harness.db, lotId)

    await groupAgain(harness, batch.batchId, lotId)

    expect(await listItems(harness.db, lotId)).toHaveLength(before.length)
  })

  it('reports progress while photos are still being analysed', async () => {
    const files = [
      { data: await makeJpeg(800, 600), mimeType: 'image/jpeg' },
      { data: await makeJpeg(800, 600), mimeType: 'image/jpeg' },
    ]
    const batch = await createBatch(harness.db, harness.blobs, { lotId, files })

    const before = await getBatchProgress(harness.db, batch.batchId)
    expect(before!.phase).toBe('analysing')
    expect(before!.analysedCount).toBe(0)
    expect(before!.photoCount).toBe(2)
    expect(before!.multiViewItems).toBeNull()

    await drainJobs(harness)

    expect((await getBatchProgress(harness.db, batch.batchId))!.phase).toBe('complete')
  })

  it('returns null progress for a batch that never existed', async () => {
    expect(await getBatchProgress(harness.db, crypto.randomUUID())).toBeNull()
  })

  it('leaves binned listings out of the board but keeps their photos', async () => {
    await uploadPhotos(1)
    const created = await listItems(harness.db, lotId)
    const victim = created[0]!

    await harness.db
      .update(items)
      .set({ status: 'discarded' })
      .where(eq(items.id, victim.id))

    const after = await listItems(harness.db, lotId)
    expect(after.filter((i) => i.status !== 'discarded')).toHaveLength(created.length - 1)

    const photos = await harness.db
      .select()
      .from(itemPhotos)
      .where(eq(itemPhotos.itemId, victim.id))
    expect(photos.length).toBeGreaterThan(0)
  })
})

async function groupAgain(harness: Harness, batchId: string, lotId: string) {
  const { groupBatchIntoItems } = await import('@/services/grouping')
  await groupBatchIntoItems(harness.db, harness.blobs, harness.matcher, { batchId, lotId })
}
