import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  identifications,
  itemPhotos,
  items,
  listings,
  valuations,
  type Identification,
  type Item,
  type ItemCondition,
  type Listing,
  type Valuation,
} from '@/db/schema'
import { isItemCategory } from '@/domain/types'
import { isDraft } from '@/domain/item-status'
import type { Enricher } from '@/ai/enricher'
import type { BlobStore } from '@/storage'
import { enqueue } from '@/jobs/queue'
import { assignSheetRows, usablePriceCents } from '@/domain/sheet-results'
import { buildContactSheet, chunkForSheets, type SheetSource } from './contact-sheet'
import { touchLot } from './lots'

export interface EnrichedListing {
  item: Item
  identification: Identification | null
  valuation: Valuation | null
  listing: Listing | null
}

/**
 * Researches one item and writes the listing it produced.
 *
 * Everything the model returned is stored, including its sources and how it
 * says it arrived at the price, because the review screen has to be able to
 * show the seller where a number came from. `priceUnconfirmed` stays true
 * until a person has looked at it; an unchecked estimate must never leave
 * the app wearing the authority of a decision.
 */
export async function enrichItem(
  db: Database,
  blobs: BlobStore,
  enricher: Enricher,
  itemId: string,
): Promise<EnrichedListing> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId)).limit(1)
  if (!item) throw new Error(`Item ${itemId} no longer exists`)

  const photos = await db
    .select()
    .from(itemPhotos)
    .where(eq(itemPhotos.itemId, itemId))
    .orderBy(desc(itemPhotos.isPrimary))

  const images = []
  for (const photo of photos.slice(0, 3)) {
    const blob = await blobs.get(photo.blobKey)
    if (blob) images.push({ data: blob.data, mimeType: blob.contentType })
  }
  if (images.length === 0) throw new Error(`Item ${itemId} has no usable photograph`)

  const result = await enricher.enrich({
    images,
    title: item.title,
    category: item.category,
    userNotes: item.userNotes,
    condition: item.condition,
    currency: item.currency,
  })

  const [identification] = await db
    .insert(identifications)
    .values({
      itemId,
      provider: enricher.name,
      productName: result.productName,
      manufacturer: result.manufacturer,
      model: result.model,
      confidence: result.confidence,
      sources: result.sources,
      raw: { priceBasis: result.priceBasis, searchQueries: result.searchQueries },
    })
    .returning()

  const [valuation] = await db
    .insert(valuations)
    .values({
      itemId,
      conditionTier: result.condition as ItemCondition,
      lowCents: result.lowCents,
      highCents: result.highCents,
      recommendedCents: result.recommendedCents,
      comparables: result.sources,
      // Recorded verbatim so the UI can say "demo placeholder" or "4 sources"
      // rather than implying every price was researched the same way.
      method: result.unsourced ? `unsourced · ${result.priceBasis}` : result.priceBasis,
    })
    .returning()

  const [listing] = await db
    .insert(listings)
    .values({
      itemId,
      marketplace: 'generic',
      title: result.title,
      description: result.description,
      priceCents: result.recommendedCents,
      negotiationLowCents: result.lowCents,
      categoryPath: result.category,
      conditionLabel: result.condition,
      status: 'draft',
    })
    .returning()

  const [updated] = await db
    .update(items)
    .set({
      title: result.title,
      brand: result.manufacturer ?? item.brand,
      model: result.model ?? item.model,
      category:
        result.category && isItemCategory(result.category) ? result.category : item.category,
      condition: result.condition as ItemCondition,
      conditionNotes: result.conditionNotes ?? item.conditionNotes,
      estimatedValueCents: result.recommendedCents,
      priceUnconfirmed: true,
      status: 'ai_identified',
      updatedAt: new Date(),
    })
    .where(eq(items.id, itemId))
    .returning()

  await touchLot(db, item.lotId)

  return {
    item: updated ?? item,
    identification: identification ?? null,
    valuation: valuation ?? null,
    listing: listing ?? null,
  }
}

/** The latest generated artefacts for an item, for the review screen. */
export async function getEnrichment(
  db: Database,
  itemId: string,
): Promise<Omit<EnrichedListing, 'item'>> {
  const [[identification], [valuation], [listing]] = await Promise.all([
    db
      .select()
      .from(identifications)
      .where(eq(identifications.itemId, itemId))
      .orderBy(desc(identifications.createdAt))
      .limit(1),
    db
      .select()
      .from(valuations)
      .where(eq(valuations.itemId, itemId))
      .orderBy(desc(valuations.createdAt))
      .limit(1),
    db
      .select()
      .from(listings)
      .where(eq(listings.itemId, itemId))
      .orderBy(desc(listings.createdAt))
      .limit(1),
  ])

  return {
    identification: identification ?? null,
    valuation: valuation ?? null,
    listing: listing ?? null,
  }
}

export interface EnrichmentRunProgress {
  requested: number
  done: number
  pending: number
}

/**
 * Queues research for the items the user approved.
 *
 * Grouping now enqueues this for every item it creates, so an item arrives
 * written up and priced and the seller only edits what they disagree with.
 * This remains for the cases automatic cannot cover: an item whose enrichment
 * failed, and one the seller wants written again after changing its title or
 * category.
 *
 * It stays a no-op on anything already reviewed. Re-running over a listing a
 * person has edited would overwrite their words with a fresh guess.
 */
export async function requestEnrichment(
  db: Database,
  lotId: string,
  itemIds: readonly string[],
): Promise<EnrichmentRunProgress> {
  if (itemIds.length === 0) return { requested: 0, done: 0, pending: 0 }

  const targets = await db
    .select({
      id: items.id,
      status: items.status,
      priceUnconfirmed: items.priceUnconfirmed,
    })
    .from(items)
    .where(and(eq(items.lotId, lotId), inArray(items.id, [...itemIds])))

  let queued = 0
  for (const target of targets) {
    /*
     * Re-running over a listing a person has looked at would overwrite their
     * words with a fresh guess. An item the sheet pass wrote has not been
     * looked at by anyone: it sits at `ai_identified` carrying an unconfirmed
     * estimate, and researching it is the entire point of asking. Without
     * this, the fast pass would lock every item out of ever getting a real
     * price.
     */
    const estimateOnly = target.status === 'ai_identified' && target.priceUnconfirmed
    if (!isDraft(target.status) && !estimateOnly) continue
    await enqueue(db, 'enrich_item', { itemId: target.id })
    queued += 1
  }

  return { requested: targets.length, done: 0, pending: queued }
}

/** Counts where a lot's enrichment run has got to, for the progress screen. */
export async function getEnrichmentProgress(
  db: Database,
  lotId: string,
): Promise<EnrichmentRunProgress> {
  const rows = await db
    .select({ status: items.status })
    .from(items)
    .where(eq(items.lotId, lotId))

  const live = rows.filter((r) => r.status !== 'discarded')
  const done = live.filter(
    (r) => r.status === 'ai_identified' || r.status === 'confirmed' || r.status === 'listed',
  ).length

  return { requested: live.length, done, pending: live.length - done }
}

/* -------------------------------------------------------------------------- */
/* A whole lot, in one call                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Names and prices every unwritten item in a lot from a single contact sheet.
 *
 * Per-item enrichment is two grounded calls and about half a minute each, so a
 * lot of twenty five was fifty calls and minutes of somebody watching a
 * spinner before they could do anything at all. Most of those items are about
 * to be binned. This gives the board something true and useful to show in one
 * call, and leaves the researched path for the items that survive triage.
 *
 * Everything written here is marked unconfirmed, because it is: a figure read
 * off a small tile with no search behind it. `priceBasis` says so in words, so
 * the export's count of unchecked prices stays honest.
 *
 * Anything the reply skipped keeps what it already had. A tile the model
 * declined to answer for is an item still waiting, not an item worth guessing
 * about from a neighbouring answer.
 */
export async function enrichLotFromSheet(
  db: Database,
  blobs: BlobStore,
  enricher: Enricher,
  lotId: string,
): Promise<{ written: number; skipped: number }> {
  if (!enricher.enrichSheet) return { written: 0, skipped: 0 }

  const pending = await db
    .select()
    .from(items)
    .where(and(eq(items.lotId, lotId), isNull(items.estimatedValueCents)))

  const targets = pending.filter((item) => isDraft(item.status))
  if (targets.length === 0) return { written: 0, skipped: 0 }

  let written = 0
  let skipped = 0

  for (const group of chunkForSheets(targets)) {
    const sources: SheetSource[] = []
    for (const item of group) {
      const [photo] = await db
        .select()
        .from(itemPhotos)
        .where(eq(itemPhotos.itemId, item.id))
        .orderBy(desc(itemPhotos.isPrimary))
        .limit(1)
      if (!photo) continue
      const blob = await blobs.get(photo.blobKey)
      if (!blob) continue
      sources.push({ itemId: item.id, data: blob.data })
    }

    if (sources.length === 0) continue

    const sheet = await buildContactSheet(sources)
    const rows = await enricher.enrichSheet({
      image: sheet.image,
      mimeType: sheet.mimeType,
      tiles: sheet.order.length,
      currency: group[0]?.currency ?? 'USD',
    })

    const { assigned, unmatched } = assignSheetRows(sheet.order, rows)
    skipped += unmatched.length

    for (const { itemId, row } of assigned) {
      const price = usablePriceCents(row.priceCents)
      if (price === null) {
        skipped += 1
        continue
      }

      const title = row.title?.trim()
      await db
        .update(items)
        .set({
          ...(title ? { title } : {}),
          ...(row.category && isItemCategory(row.category) ? { category: row.category } : {}),
          ...(row.condition && CONDITIONS.has(row.condition)
            ? { condition: row.condition as ItemCondition }
            : {}),
          estimatedValueCents: price,
          priceUnconfirmed: true,
          status: 'ai_identified',
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId))

      if (row.description) {
        await db.insert(listings).values({
          itemId,
          marketplace: 'facebook',
          title: title ?? 'Untitled item',
          description: row.description,
          priceCents: price,
          status: 'draft',
        })
      }

      written += 1
    }
  }

  await touchLot(db, lotId)
  return { written, skipped }
}

const CONDITIONS = new Set([
  'new',
  'like_new',
  'excellent',
  'good',
  'fair',
  'poor',
  'for_parts',
])
