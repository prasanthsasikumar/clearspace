import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { itemPhotos, items, listings, valuations } from '@/db/schema'
import { buildAuctionCatalog, type AuctionItem, type AuctionWarning } from '@/domain/export/auction'
import { buildFacebookFeed, type ExportResult, type ExportableItem } from '@/domain/export/facebook'
import { buildMarketplaceSheet, type MarketplaceResult } from '@/domain/export/marketplace'
import { assignLotNumbers } from '@/domain/export/lot-numbers'
import { zip, type ZipEntry } from '@/lib/zip'
import { extensionForMime, type BlobStore } from '@/storage'

export interface BuildExportInput {
  lotId: string
  /** Absolute origin, e.g. http://192.168.1.19:3300; feeds need real URLs. */
  origin: string
  itemIds?: readonly string[]
}

export interface LotExport extends ExportResult {
  filename: string
  /** Items priced by the model that nobody has checked. */
  unconfirmedPrices: number
}

/**
 * Assembles a Facebook catalogue feed for a lot.
 *
 * The count of unconfirmed prices rides along with the file. Exporting is the
 * last moment the app can point out that a number came from a model and not
 * from a person, and staying quiet at that moment would be the app's most
 * consequential omission.
 */
export async function buildLotExport(
  db: Database,
  input: BuildExportInput,
): Promise<LotExport> {
  const rows = await db
    .select()
    .from(items)
    .where(
      input.itemIds && input.itemIds.length > 0
        ? and(eq(items.lotId, input.lotId), inArray(items.id, [...input.itemIds]))
        : and(eq(items.lotId, input.lotId), ne(items.status, 'discarded')),
    )

  const live = rows.filter((item) => item.status !== 'discarded')
  if (live.length === 0) {
    return {
      csv: buildFacebookFeed([]).csv,
      rowCount: 0,
      skipped: [],
      warnings: [],
      filename: 'clearspace-facebook-catalog.csv',
      unconfirmedPrices: 0,
    }
  }

  const ids = live.map((item) => item.id)

  const [photos, drafts] = await Promise.all([
    db
      .select()
      .from(itemPhotos)
      .where(inArray(itemPhotos.itemId, ids))
      .orderBy(desc(itemPhotos.isPrimary)),
    db.select().from(listings).where(inArray(listings.itemId, ids)).orderBy(desc(listings.createdAt)),
  ])

  const photosByItem = new Map<string, string[]>()
  for (const photo of photos) {
    const bucket = photosByItem.get(photo.itemId) ?? []
    bucket.push(`${input.origin}/api/blobs/${photo.blobKey}`)
    photosByItem.set(photo.itemId, bucket)
  }

  // Newest listing wins; the query is already ordered so the first seen is it.
  const listingByItem = new Map<string, (typeof drafts)[number]>()
  for (const draft of drafts) {
    if (!listingByItem.has(draft.itemId)) listingByItem.set(draft.itemId, draft)
  }

  const exportable: ExportableItem[] = live.map((item) => {
    const draft = listingByItem.get(item.id)
    return {
      id: item.id,
      title: draft?.title ?? item.title,
      description: draft?.description ?? item.userNotes,
      condition: item.condition,
      priceCents: draft?.priceCents ?? item.estimatedValueCents,
      currency: item.currency,
      brand: item.brand,
      category: item.category,
      imageUrls: photosByItem.get(item.id) ?? [],
      itemUrl: `${input.origin}/items/${item.id}`,
    }
  })

  const result = buildFacebookFeed(exportable)

  return {
    ...result,
    filename: 'clearspace-facebook-catalog.csv',
    unconfirmedPrices: live.filter(
      (item) => item.priceUnconfirmed && item.estimatedValueCents !== null,
    ).length,
  }
}

export interface LotMarketplaceExport extends MarketplaceResult {
  filename: string
  unconfirmedPrices: number
}

/**
 * Assembles the Marketplace bulk-upload workbook for a lot.
 *
 * Shares the catalogue feed's read of the lot, including the rule that the
 * newest written listing beats whatever the item row still says, so the two
 * exports can never disagree about a title or a price. What it does not need
 * is photographs: the template has no image column, because a private seller
 * adds the pictures in the Marketplace composer after the listings land.
 */
export async function buildLotMarketplaceExport(
  db: Database,
  input: Pick<BuildExportInput, 'lotId' | 'itemIds'>,
): Promise<LotMarketplaceExport> {
  const rows = await db
    .select()
    .from(items)
    .where(
      input.itemIds && input.itemIds.length > 0
        ? and(eq(items.lotId, input.lotId), inArray(items.id, [...input.itemIds]))
        : and(eq(items.lotId, input.lotId), ne(items.status, 'discarded')),
    )

  const live = rows.filter((item) => item.status !== 'discarded')
  const filename = 'clearspace-marketplace.xlsx'

  if (live.length === 0) {
    return { ...buildMarketplaceSheet([]), filename, unconfirmedPrices: 0 }
  }

  const ids = live.map((item) => item.id)
  const drafts = await db
    .select()
    .from(listings)
    .where(inArray(listings.itemId, ids))
    .orderBy(desc(listings.createdAt))

  const listingByItem = new Map<string, (typeof drafts)[number]>()
  for (const draft of drafts) {
    if (!listingByItem.has(draft.itemId)) listingByItem.set(draft.itemId, draft)
  }

  const result = buildMarketplaceSheet(
    live.map((item) => {
      const draft = listingByItem.get(item.id)
      return {
        id: item.id,
        title: draft?.title ?? item.title,
        priceCents: draft?.priceCents ?? item.estimatedValueCents,
        condition: item.condition,
        description: draft?.description ?? item.userNotes,
      }
    }),
  )

  return {
    ...result,
    filename,
    unconfirmedPrices: live.filter(
      (item) => item.priceUnconfirmed && item.estimatedValueCents !== null,
    ).length,
  }
}

/** Marks exported items so the board stops asking about them. */
export async function markExported(
  db: Database,
  itemIds: readonly string[],
): Promise<number> {
  if (itemIds.length === 0) return 0
  const updated = await db
    .update(items)
    .set({ status: 'listed', updatedAt: new Date() })
    .where(and(inArray(items.id, [...itemIds]), eq(items.status, 'confirmed')))
    .returning({ id: items.id })
  return updated.length
}

export interface LotAuctionExport {
  /** One ZIP holding lots.csv and every photo it references. */
  archive: Buffer
  filename: string
  rowCount: number
  skipped: AuctionWarning[]
  warnings: AuctionWarning[]
  unconfirmedPrices: number
}

/**
 * Builds one archive an auctioneer can upload: the lot catalogue and its
 * photographs, named to match.
 *
 * They are packed together rather than downloaded separately because the
 * failure this design exists to prevent is a filename in a row pointing at a
 * photograph that is not there — and that failure is discovered by the
 * recipient, mid-upload, not by us. Generating both from a single ordering
 * pass into a single archive makes the disagreement unrepresentable.
 */
export async function buildLotAuctionExport(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string; itemIds?: readonly string[] },
): Promise<LotAuctionExport> {
  const filename = 'clearspace-auction.zip'

  // createdAt order is the ordering the whole export is built from. Reordering
  // lots is deliberately not supported here; auctioneers do it in Auction Flex.
  const rows = await db
    .select()
    .from(items)
    .where(
      input.itemIds && input.itemIds.length > 0
        ? and(eq(items.lotId, input.lotId), inArray(items.id, [...input.itemIds]))
        : and(eq(items.lotId, input.lotId), ne(items.status, 'discarded')),
    )
    .orderBy(asc(items.createdAt))

  const live = rows.filter((item) => item.status !== 'discarded')

  if (live.length === 0) {
    const empty = buildAuctionCatalog([])
    return {
      archive: zip([{ name: 'lots.csv', data: Buffer.from(empty.csv, 'utf8') }]),
      filename,
      rowCount: 0,
      skipped: [],
      warnings: [],
      unconfirmedPrices: 0,
    }
  }

  const ids = live.map((item) => item.id)
  const numbers = assignLotNumbers(live)

  const [photos, drafts, prices] = await Promise.all([
    db
      .select()
      .from(itemPhotos)
      .where(inArray(itemPhotos.itemId, ids))
      .orderBy(desc(itemPhotos.isPrimary)),
    db.select().from(listings).where(inArray(listings.itemId, ids)).orderBy(desc(listings.createdAt)),
    db.select().from(valuations).where(inArray(valuations.itemId, ids)).orderBy(desc(valuations.createdAt)),
  ])

  // Newest wins for both, matching the rule the other exports already follow.
  const listingByItem = new Map<string, (typeof drafts)[number]>()
  for (const draft of drafts) {
    if (!listingByItem.has(draft.itemId)) listingByItem.set(draft.itemId, draft)
  }
  const valuationByItem = new Map<string, (typeof prices)[number]>()
  for (const price of prices) {
    if (!valuationByItem.has(price.itemId)) valuationByItem.set(price.itemId, price)
  }

  const photosByItem = new Map<string, (typeof photos)[number][]>()
  for (const photo of photos) {
    const bucket = photosByItem.get(photo.itemId) ?? []
    bucket.push(photo)
    photosByItem.set(photo.itemId, bucket)
  }

  // One pass: fetch the bytes, name the entry, and keep both against the item,
  // so deciding what to pack later is a lookup rather than a guess from the
  // shape of a filename.
  const entriesByItem = new Map<string, ZipEntry[]>()

  for (const item of live) {
    const lotNumber = numbers.get(item.id)!
    const itemEntries: ZipEntry[] = []

    for (const photo of photosByItem.get(item.id) ?? []) {
      const blob = await blobs.get(photo.blobKey)
      // A photo row whose blob has gone is skipped rather than named, because
      // naming it would put a filename in the CSV with nothing behind it.
      if (!blob) continue

      const name = `${lotNumber}_${itemEntries.length + 1}.${extensionForMime(blob.contentType)}`
      itemEntries.push({ name, data: blob.data })
    }

    entriesByItem.set(item.id, itemEntries)
  }

  const catalogItems: AuctionItem[] = live.map((item) => {
    const draft = listingByItem.get(item.id)
    const valuation = valuationByItem.get(item.id)
    return {
      id: item.id,
      lotNumber: numbers.get(item.id)!,
      title: draft?.title ?? item.title,
      description: draft?.description ?? item.userNotes,
      condition: item.condition,
      lowCents: valuation?.lowCents ?? null,
      highCents: valuation?.highCents ?? null,
      reserveCents: item.reserveCents,
      category: item.category,
      photoFilenames: (entriesByItem.get(item.id) ?? []).map((e) => e.name),
    }
  })

  const catalog = buildAuctionCatalog(catalogItems)

  // Persist only after the catalogue is built, so a formatter that throws
  // leaves no numbers behind to constrain the next attempt.
  const skippedIds = new Set(catalog.skipped.map((s) => s.itemId))
  await Promise.all(
    live
      .filter((item) => item.lotNumber === null && !skippedIds.has(item.id))
      .map((item) =>
        db
          .update(items)
          .set({ lotNumber: numbers.get(item.id)!, updatedAt: new Date() })
          .where(eq(items.id, item.id)),
      ),
  )

  // Only the photographs of lots that actually became rows. Shipping the rest
  // would put files in the archive that nothing references, which reads to the
  // recipient as an export that lost their data.
  const packed = live
    .filter((item) => !skippedIds.has(item.id))
    .flatMap((item) => entriesByItem.get(item.id) ?? [])

  return {
    archive: zip([
      { name: 'lots.csv', data: Buffer.from(catalog.csv, 'utf8') },
      ...packed,
    ]),
    filename,
    rowCount: catalog.rowCount,
    skipped: catalog.skipped,
    warnings: catalog.warnings,
    unconfirmedPrices: live.filter(
      (item) => item.priceUnconfirmed && valuationByItem.has(item.id),
    ).length,
  }
}
