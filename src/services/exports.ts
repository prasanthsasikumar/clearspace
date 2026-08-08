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
 * Runs `fn` over `items` with at most `limit` calls in flight, in a fixed
 * pool rather than chunked batches, so a slow fetch for one item does not
 * hold up starting the next one behind it.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index]!)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * The extension a photo should be named with in the archive.
 *
 * `extensionForMime` maps an unrecognised or missing content-type to `bin`,
 * and `SupabaseBlobStore.get` hands back exactly that generic type whenever a
 * response omits the header. The CSV row and the archive entry would still
 * agree in that case — the invariant holds — but the auctioneer would be
 * handed a `12_1.bin` their system refuses to open. The blob key was written
 * with the right extension at upload time (see `makeBlobKey`), so that is
 * what a bad or absent content-type falls back to before giving up and
 * calling it a generic photo.
 */
function photoExtension(blobKey: string, contentType: string): string {
  const fromMime = extensionForMime(contentType)
  if (fromMime !== 'bin') return fromMime

  const fromKey = blobKey.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  return fromKey ?? 'jpg'
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
 *
 * Deliberately takes no item filter, unlike its Facebook and Marketplace
 * siblings. `assignLotNumbers` derives its high-water mark from `Math.max`
 * over whatever rows it is given, and this function persists the numbers it
 * assigns — so a narrowed view of the lot would compute a mark blind to every
 * item outside it and then write numbers that collide with them. The other
 * two exports accept `itemIds` safely only because they persist nothing.
 */
export async function buildLotAuctionExport(
  db: Database,
  blobs: BlobStore,
  input: { lotId: string },
): Promise<LotAuctionExport> {
  const filename = 'clearspace-auction.zip'

  // createdAt order is the ordering the whole export is built from. Reordering
  // lots is deliberately not supported here; auctioneers do it in Auction Flex.
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.lotId, input.lotId), ne(items.status, 'discarded')))
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

  // One pass per item: fetch the bytes, name the entry, and keep both against
  // the item, so deciding what to pack later is a lookup rather than a guess
  // from the shape of a filename.
  //
  // Fetched across items in parallel, bounded, because serial round-trips do
  // not scale: a 150-item lot at 3 photos each is 450 sequential blob fetches,
  // tens of seconds against a function timeout, while holding roughly 2x the
  // total photo bytes in memory once concatenated into the archive. Bounding
  // rather than fetching everything at once keeps that memory ceiling in
  // check. This is a mitigation, not a fix for the underlying shape — a
  // genuinely large lot wants a streamed archive or a queued job that hands
  // back a blob key instead of building the whole ZIP in one function's
  // memory.
  //
  // Within an item, fetches stay sequential and in order: the entry name uses
  // the running count of that item's own photos so far, so racing an item's
  // own photos against each other would make the numbering sparse or
  // unstable whenever one fetch finished before another.
  const PHOTO_FETCH_CONCURRENCY = 8
  const entryLists = await mapWithConcurrency(live, PHOTO_FETCH_CONCURRENCY, async (item) => {
    const lotNumber = numbers.get(item.id)!
    const itemEntries: ZipEntry[] = []

    for (const photo of photosByItem.get(item.id) ?? []) {
      const blob = await blobs.get(photo.blobKey)
      // A photo row whose blob has gone is skipped rather than named, because
      // naming it would put a filename in the CSV with nothing behind it.
      if (!blob) continue

      const name = `${lotNumber}_${itemEntries.length + 1}.${photoExtension(photo.blobKey, blob.contentType)}`
      itemEntries.push({ name, data: blob.data })
    }

    return [item.id, itemEntries] as const
  })
  const entriesByItem = new Map<string, ZipEntry[]>(entryLists)

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
