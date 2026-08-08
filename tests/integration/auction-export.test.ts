import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { items, itemPhotos, lots, users, valuations } from '@/db/schema'
import { createHarness, type Harness } from '../helpers/harness'
import { buildLotAuctionExport } from '@/services/exports'

let harness: Harness

afterEach(async () => {
  await harness?.close()
})

describe('auction schema', () => {
  it('stores a lot number and a reserve, and defaults both to null', async () => {
    harness = await createHarness()
    const { db } = harness

    const [user] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: user!.id, name: 'Ashfield estate', kind: 'estate' })
      .returning()

    const [plain] = await db
      .insert(items)
      .values({ lotId: lot!.id, title: 'Walnut sideboard' })
      .returning()

    expect(plain!.lotNumber).toBeNull()
    expect(plain!.reserveCents).toBeNull()

    await db
      .update(items)
      .set({ lotNumber: 12, reserveCents: 15000 })
      .where(eq(items.id, plain!.id))

    const [updated] = await db.select().from(items).where(eq(items.id, plain!.id))
    expect(updated!.lotNumber).toBe(12)
    expect(updated!.reserveCents).toBe(15000)
  })
})

/**
 * Unpacks a stored-entry ZIP by walking its local headers.
 *
 * Reading the entries properly rather than searching the archive as a string
 * is the whole point: entry names appear in the ZIP headers, so a test that
 * stringifies the archive and looks for a filename passes whether or not the
 * CSV ever mentions it.
 */
function readEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>()
  let i = 0

  while (i + 30 <= archive.length && archive.readUInt32LE(i) === 0x04034b50) {
    const size = archive.readUInt32LE(i + 18)
    const nameLength = archive.readUInt16LE(i + 26)
    const extraLength = archive.readUInt16LE(i + 28)
    const name = archive.subarray(i + 30, i + 30 + nameLength).toString('utf8')
    const start = i + 30 + nameLength + extraLength

    entries.set(name, archive.subarray(start, start + size))
    i = start + size
  }

  return entries
}

describe('buildLotAuctionExport', () => {
  async function seedLot() {
    harness = await createHarness()
    const { db, blobs } = harness

    const [user] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: user!.id, name: 'Ashfield estate', kind: 'estate' })
      .returning()

    const [item] = await db
      .insert(items)
      .values({
        lotId: lot!.id,
        title: 'Walnut sideboard',
        condition: 'good',
        status: 'confirmed',
      })
      .returning()

    await db.insert(valuations).values({
      itemId: item!.id,
      conditionTier: 'good',
      lowCents: 12000,
      highCents: 18000,
      recommendedCents: 15000,
      method: 'test',
    })

    await blobs.put('items/test/a.jpg', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg')
    await db.insert(itemPhotos).values({
      itemId: item!.id,
      blobKey: 'items/test/a.jpg',
      isPrimary: true,
    })

    return { db, blobs, lot: lot!, item: item! }
  }

  it('every photo the CSV names is in the archive, and every photo in the archive is named', async () => {
    const { db, blobs, lot } = await seedLot()

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const entries = readEntries(result.archive)

    const csvBytes = entries.get('lots.csv')
    expect(csvBytes).toBeDefined()
    const csv = csvBytes!.toString('utf8')

    const photoNames = [...entries.keys()].filter((n) => n !== 'lots.csv')
    expect(photoNames.length).toBeGreaterThan(0)

    // Both directions. One alone leaves the other failure mode open.
    const namedInCsv = new Set(
      [...csv.matchAll(/[0-9]+_[0-9]+\.[a-z]+/g)].map((m) => m[0]),
    )
    expect([...namedInCsv].sort()).toEqual([...photoNames].sort())
  })

  it('names photos by lot number so a filename identifies its row', async () => {
    const { db, blobs, lot } = await seedLot()

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    expect([...readEntries(result.archive).keys()]).toContain('1_1.jpg')
  })

  it('does not ship photographs belonging to a lot the CSV left out', async () => {
    const { db, blobs, lot } = await seedLot()

    // Confirmed and photographed, but never estimated, so it cannot be a row.
    const [orphan] = await db
      .insert(items)
      .values({ lotId: lot.id, title: 'Unestimated bureau', status: 'confirmed' })
      .returning()

    await blobs.put('items/test/b.jpg', Buffer.from([0xff, 0xd8, 0xfe]), 'image/jpeg')
    await db
      .insert(itemPhotos)
      .values({ itemId: orphan!.id, blobKey: 'items/test/b.jpg', isPrimary: true })

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const photoNames = [...readEntries(result.archive).keys()].filter((n) => n !== 'lots.csv')

    expect(result.rowCount).toBe(1)
    expect(photoNames).toEqual(['1_1.jpg'])
  })

  it('persists the lot number, so a second export does not renumber', async () => {
    const { db, blobs, lot, item } = await seedLot()

    await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const [first] = await db.select().from(items).where(eq(items.id, item.id))
    expect(first!.lotNumber).toBe(1)

    await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    const [second] = await db.select().from(items).where(eq(items.id, item.id))
    expect(second!.lotNumber).toBe(1)
  })

  it('leaves an unestimated item out and says so', async () => {
    const { db, blobs, lot } = await seedLot()

    await db.insert(items).values({
      lotId: lot.id,
      title: 'Box of assorted linen',
      status: 'confirmed',
    })

    const result = await buildLotAuctionExport(db, blobs, { lotId: lot.id })
    expect(result.rowCount).toBe(1)
    expect(result.skipped.some((s) => s.field === 'estimate')).toBe(true)
  })
})

describe('the auction export route', () => {
  it('refuses a lot belonging to someone else', async () => {
    harness = await createHarness()
    const { db } = harness

    const [mine] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [theirs] = await db.insert(users).values({ isAnonymous: true }).returning()
    const [lot] = await db
      .insert(lots)
      .values({ userId: theirs!.id, name: 'Not yours', kind: 'estate' })
      .returning()

    const { getLot } = await import('@/services/lots')
    expect(await getLot(db, mine!.id, lot!.id)).toBeFalsy()
  })
})
