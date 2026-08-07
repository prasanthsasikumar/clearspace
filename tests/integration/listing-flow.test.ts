import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, drainJobs, makeJpeg, type Harness } from '../helpers/harness'
import { FixtureEnricher } from '@/ai/enricher'
import { items } from '@/db/schema'
import { createBatch } from '@/services/batches'
import { createLot } from '@/services/lots'
import { listItems, updateItem } from '@/services/items'
import { getCurrentUser } from '@/services/user'
import { getEnrichment, getEnrichmentProgress, requestEnrichment } from '@/services/enrichment'
import { buildLotExport } from '@/services/exports'

/**
 * Draft → written listing → export, end to end.
 *
 * The assertions that matter most are the honesty ones: a price nobody checked
 * stays flagged, and the export says how many of those it is carrying.
 */
describe('listings and export', () => {
  let harness: Harness
  let lotId: string

  beforeEach(async () => {
    harness = await createHarness()
    const user = await getCurrentUser(harness.db)
    const lot = await createLot(harness.db, user.id, { name: 'Garage', kind: 'garage' })
    lotId = lot.id

    await createBatch(harness.db, harness.blobs, {
      lotId,
      files: [{ data: await makeJpeg(1000, 800), mimeType: 'image/jpeg' }],
    })
    await drainJobs(harness)
  })

  afterEach(async () => {
    await harness.close()
  })

  it('drafts every item from a single photograph', async () => {
    const created = await listItems(harness.db, lotId)
    expect(created.length).toBeGreaterThan(0)
    // One photo is enough. Nothing may sit in "photos needed".
    for (const item of created) expect(item.status).toBe('needs_confirmation')
  })

  it('writes a listing, a valuation, and an identification per approved item', async () => {
    const [first] = await listItems(harness.db, lotId)
    await requestEnrichment(harness.db, lotId, [first!.id])
    await drainJobs(harness)

    const enrichment = await getEnrichment(harness.db, first!.id)
    expect(enrichment.listing?.description.length).toBeGreaterThan(0)
    expect(enrichment.valuation?.recommendedCents).toBeGreaterThan(0)
    expect(enrichment.identification?.provider).toBe('fixture-enricher')

    const [after] = await harness.db.select().from(items).where(eq(items.id, first!.id))
    expect(after!.status).toBe('ai_identified')
    expect(after!.estimatedValueCents).toBe(enrichment.valuation!.recommendedCents)
    // Nothing a model produced is treated as checked.
    expect(after!.priceUnconfirmed).toBe(true)
  })

  it('records an unsourced price as unsourced rather than dressing it up', async () => {
    const [first] = await listItems(harness.db, lotId)
    await requestEnrichment(harness.db, lotId, [first!.id])
    await drainJobs(harness)

    const { valuation } = await getEnrichment(harness.db, first!.id)
    expect(valuation!.method).toMatch(/^unsourced/)
    expect(valuation!.comparables).toEqual([])
  })

  it('keeps a sourced price’s comparables', async () => {
    const sourced = await createHarness({
      enricher: new FixtureEnricher({
        unsourced: false,
        priceBasis: 'Three completed listings in the last month.',
        sources: [{ title: 'A sold listing', url: 'https://example.test/sold' }],
      }),
    })
    try {
      const user = await getCurrentUser(sourced.db)
      const lot = await createLot(sourced.db, user.id, { name: 'Shed', kind: 'garage' })
      await createBatch(sourced.db, sourced.blobs, {
        lotId: lot.id,
        files: [{ data: await makeJpeg(800, 600), mimeType: 'image/jpeg' }],
      })
      await drainJobs(sourced)

      const [first] = await listItems(sourced.db, lot.id)
      await requestEnrichment(sourced.db, lot.id, [first!.id])
      await drainJobs(sourced)

      const { valuation, identification } = await getEnrichment(sourced.db, first!.id)
      expect(valuation!.method).not.toMatch(/^unsourced/)
      expect(identification!.sources).toHaveLength(1)
    } finally {
      await sourced.close()
    }
  })

  it('will not re-write a listing the user already reviewed', async () => {
    const [first] = await listItems(harness.db, lotId)
    await requestEnrichment(harness.db, lotId, [first!.id])
    await drainJobs(harness)
    await updateItem(harness.db, first!.id, { status: 'confirmed' })

    const second = await requestEnrichment(harness.db, lotId, [first!.id])

    // Re-running would overwrite the seller's own edits with a fresh guess.
    expect(second.pending).toBe(0)
  })

  it('reports how far an enrichment run has got', async () => {
    const all = await listItems(harness.db, lotId)
    await requestEnrichment(harness.db, lotId, [all[0]!.id])

    const before = await getEnrichmentProgress(harness.db, lotId)
    expect(before.done).toBe(0)

    await drainJobs(harness)

    const after = await getEnrichmentProgress(harness.db, lotId)
    expect(after.done).toBe(1)
  })

  it('exports a feed and says how many prices nobody checked', async () => {
    const all = await listItems(harness.db, lotId)
    await requestEnrichment(
      harness.db,
      lotId,
      all.map((i) => i.id),
    )
    await drainJobs(harness)

    const result = await buildLotExport(harness.db, {
      lotId,
      origin: 'https://sorta.test',
    })

    expect(result.rowCount).toBe(all.length)
    expect(result.unconfirmedPrices).toBe(all.length)
    expect(result.csv).toContain('https://sorta.test/api/blobs/')
    expect(result.csv).toContain('https://sorta.test/items/')
  })

  it('stops counting a price as unchecked once the user confirms it', async () => {
    const [first] = await listItems(harness.db, lotId)
    await requestEnrichment(harness.db, lotId, [first!.id])
    await drainJobs(harness)
    await updateItem(harness.db, first!.id, { priceUnconfirmed: false })

    const result = await buildLotExport(harness.db, { lotId, origin: 'https://sorta.test' })
    expect(result.unconfirmedPrices).toBe(0)
  })

  it('leaves binned items out of the export', async () => {
    const all = await listItems(harness.db, lotId)
    await requestEnrichment(
      harness.db,
      lotId,
      all.map((i) => i.id),
    )
    await drainJobs(harness)
    await updateItem(harness.db, all[0]!.id, { status: 'discarded' })

    const result = await buildLotExport(harness.db, { lotId, origin: 'https://sorta.test' })
    expect(result.rowCount).toBe(all.length - 1)
  })
})
