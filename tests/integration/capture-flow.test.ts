import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drainJobs, makeJpeg, type Harness } from '../helpers/harness'
import { FixtureVisionProvider } from '@/ai/fixture-provider'
import { detections as detectionsTable, items as itemsTable } from '@/db/schema'
import { createLot } from '@/services/lots'
import { getCurrentUser } from '@/services/user'
import { createImageScan, getScanDetail } from '@/services/scans'
import {
  addItemPhoto,
  addManualDetection,
  deleteItemPhoto,
  dismissDetection,
  getItemDetail,
  promoteDetection,
  updateItem,
} from '@/services/items'

/**
 * The Phase 1 loop, end to end, against real Postgres and real image
 * processing. Only the vision vendor is replaced — with recorded responses,
 * not a mock, so the parsing and coordinate conversion under test are the same
 * code the live provider runs.
 */
describe('capture → detect → promote', () => {
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

  async function scanARoom() {
    const { scan } = await createImageScan(harness.db, harness.blobs, {
      lotId,
      kind: 'scene',
      file: { data: await makeJpeg(1600, 1200), mimeType: 'image/jpeg' },
    })
    await drainJobs(harness)
    const detail = await getScanDetail(harness.db, scan.id)
    if (!detail) throw new Error('scan vanished')
    return detail
  }

  it('stores the upload, runs detection, and marks the scan complete', async () => {
    const detail = await scanARoom()

    expect(detail.scan.status).toBe('complete')
    expect(detail.scan.blobKey).toBeTruthy()
    expect(await harness.blobs.get(detail.scan.blobKey!)).not.toBeNull()
    expect(detail.detections.length).toBeGreaterThan(0)
  })

  it('normalizes every stored box into the 0-1 contract', async () => {
    const detail = await scanARoom()
    for (const detection of detail.detections) {
      const { x, y, w, h } = detection.bbox
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x + w).toBeLessThanOrEqual(1)
      expect(y + h).toBeLessThanOrEqual(1)
      expect(w).toBeGreaterThan(0)
    }
  })

  it('promotes a detection into an item carrying a crop of the scene', async () => {
    const detail = await scanARoom()
    const chair = detail.detections.find((d) => d.label.includes('chair'))!

    const item = await promoteDetection(harness.db, harness.blobs, chair.id)

    expect(item.title).toBe('Mesh office chair')
    expect(item.category).toBe('furniture')
    expect(item.status).toBe('photos_needed')
    // Nothing may claim a price before the pricing pipeline exists.
    expect(item.estimatedValueCents).toBeNull()

    const withPhotos = await getItemDetail(harness.db, item.id)
    expect(withPhotos!.photos).toHaveLength(1)
    expect(withPhotos!.photos[0]!.isPrimary).toBe(true)
    expect(await harness.blobs.get(withPhotos!.photos[0]!.blobKey)).not.toBeNull()
  })

  it('is idempotent — a double tap does not create two items', async () => {
    const detail = await scanARoom()
    const target = detail.detections[0]!

    const first = await promoteDetection(harness.db, harness.blobs, target.id)
    const second = await promoteDetection(harness.db, harness.blobs, target.id)

    expect(second.id).toBe(first.id)
    const all = await harness.db.select().from(itemsTable).where(eq(itemsTable.lotId, lotId))
    expect(all).toHaveLength(1)
  })

  it('hides a dismissed detection without touching the others', async () => {
    const detail = await scanARoom()
    const before = detail.detections.length

    await dismissDetection(harness.db, detail.detections[0]!.id)

    const after = await getScanDetail(harness.db, detail.scan.id)
    expect(after!.detections).toHaveLength(before - 1)
  })

  it('accepts a box the user drew around something the model missed', async () => {
    const detail = await scanARoom()

    const id = await addManualDetection(harness.db, detail.scan.id, {
      label: 'record crate',
      category: 'books_media',
      bbox: { x: 0.05, y: 0.7, w: 0.2, h: 0.2 },
    })

    const [stored] = await harness.db
      .select()
      .from(detectionsTable)
      .where(eq(detectionsTable.id, id))
    expect(stored!.source).toBe('user')
    expect(stored!.confidence).toBeNull()

    const item = await promoteDetection(harness.db, harness.blobs, id)
    expect(item.title).toBe('Record crate')
  })

  it('moves an item to confirmation once its category’s required views exist', async () => {
    const detail = await scanARoom()
    const chair = detail.detections.find((d) => d.label.includes('chair'))!
    const item = await promoteDetection(harness.db, harness.blobs, chair.id)

    const jpeg = await makeJpeg(1024, 768)
    for (const view of ['front', 'side', 'damage'] as const) {
      await addItemPhoto(harness.db, harness.blobs, item.id, {
        data: jpeg,
        mimeType: 'image/jpeg',
        view,
      })
    }

    const detailAfter = await getItemDetail(harness.db, item.id)
    expect(detailAfter!.coverage.isListable).toBe(true)
    expect(detailAfter!.item.status).toBe('needs_confirmation')
  })

  it('sends an item back to photos-needed when a required photo is deleted', async () => {
    const detail = await scanARoom()
    const item = await promoteDetection(
      harness.db,
      harness.blobs,
      detail.detections.find((d) => d.label.includes('chair'))!.id,
    )

    const jpeg = await makeJpeg(1024, 768)
    const added = []
    for (const view of ['front', 'side', 'damage'] as const) {
      added.push(
        await addItemPhoto(harness.db, harness.blobs, item.id, {
          data: jpeg,
          mimeType: 'image/jpeg',
          view,
        }),
      )
    }

    await deleteItemPhoto(harness.db, harness.blobs, added[0]!.id)

    const after = await getItemDetail(harness.db, item.id)
    expect(after!.coverage.isListable).toBe(false)
    expect(after!.item.status).toBe('photos_needed')
  })

  it('does not walk a confirmed item backwards when photos change', async () => {
    const detail = await scanARoom()
    const item = await promoteDetection(harness.db, harness.blobs, detail.detections[0]!.id)

    const jpeg = await makeJpeg(1024, 768)
    for (const view of ['front', 'side', 'damage'] as const) {
      await addItemPhoto(harness.db, harness.blobs, item.id, {
        data: jpeg,
        mimeType: 'image/jpeg',
        view,
      })
    }
    await updateItem(harness.db, item.id, { status: 'confirmed' })

    const photos = (await getItemDetail(harness.db, item.id))!.photos
    await deleteItemPhoto(harness.db, harness.blobs, photos[0]!.id)

    const after = await getItemDetail(harness.db, item.id)
    expect(after!.item.status).toBe('confirmed')
  })

  it('re-derives the shot list when the category changes', async () => {
    const detail = await scanARoom()
    const item = await promoteDetection(harness.db, harness.blobs, detail.detections[0]!.id)

    await updateItem(harness.db, item.id, { category: 'electronics' })

    const after = await getItemDetail(harness.db, item.id)
    expect(after!.coverage.requirements.map((r) => r.view)).toContain('serial')
  })

  it('refuses a status jump that skips confirmation', async () => {
    const detail = await scanARoom()
    const item = await promoteDetection(harness.db, harness.blobs, detail.detections[0]!.id)

    await expect(updateItem(harness.db, item.id, { status: 'sold' })).rejects.toThrow(
      /Photos needed.*Sold/,
    )
  })

  it('records the failure and leaves the scan recoverable when the model is down', async () => {
    const failing = await createHarness({
      vision: new FixtureVisionProvider({ error: new Error('model unavailable') }),
    })
    try {
      const user = await getCurrentUser(failing.db)
      const lot = await createLot(failing.db, user.id, { name: 'Garage', kind: 'garage' })
      const { scan } = await createImageScan(failing.db, failing.blobs, {
        lotId: lot.id,
        kind: 'scene',
        file: { data: await makeJpeg(800, 600), mimeType: 'image/jpeg' },
      })

      await drainJobs(failing)

      const detail = await getScanDetail(failing.db, scan.id)
      expect(detail!.detections).toHaveLength(0)
      expect(detail!.scan.error).toContain('model unavailable')
      // Still `processing`, not `complete` — the queue has retries left.
      expect(detail!.scan.status).toBe('processing')
    } finally {
      await failing.close()
    }
  })
})
