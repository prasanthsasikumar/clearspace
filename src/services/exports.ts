import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { itemPhotos, items, listings } from '@/db/schema'
import { buildFacebookFeed, type ExportResult, type ExportableItem } from '@/domain/export/facebook'

export interface BuildExportInput {
  lotId: string
  /** Absolute origin, e.g. http://192.168.1.19:3300 — feeds need real URLs. */
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
      filename: 'sorta-facebook-catalog.csv',
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
    filename: 'sorta-facebook-catalog.csv',
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
