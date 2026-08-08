import type { EnrichmentInput, EnrichmentResult } from './gemini/enrichment'

export type { EnrichmentInput, EnrichmentResult, EnrichmentSource } from './gemini/enrichment'

/**
 * Turns an item and its photographs into a listing with a sourced price.
 *
 * Its own port because the honest implementation is two model calls with
 * grounded search, and a future one might be an eBay comparables lookup with
 * no model at all. The service that calls this cares about neither.
 */
/** What one tile of a contact sheet comes back as. */
export interface SheetEnrichment {
  n: number
  title: string | null
  category: string | null
  condition: string | null
  priceCents: number | null
  description: string | null
}

export interface SheetInput {
  image: Buffer
  mimeType: string
  /** Tile count, so the prompt can say how many answers are expected. */
  tiles: number
  currency: string
}

export interface Enricher {
  readonly name: string
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>
  /**
   * A whole sheet of items in one call.
   *
   * Deliberately not the same job as `enrich`. That one researches a single
   * thing properly and says where the number came from; this one looks at a
   * page of small pictures and gives every item a name and a plausible figure
   * in a couple of seconds. A lot of twenty five used to cost fifty calls and
   * several minutes of somebody watching a spinner, which is a poor trade for
   * research nobody asked for yet on items most of which are about to be
   * binned.
   *
   * Prices from here are guesses and must be recorded as such.
   */
  enrichSheet?(input: SheetInput): Promise<SheetEnrichment[]>
}

/**
 * A recorded enrichment, so demo mode and the test suite exercise the whole
 * write path (identification, valuation, listing, status) without a network.
 *
 * It reports `unsourced: true` and says so in `priceBasis`, because a fixture
 * price is exactly the kind of number the app promises never to dress up as
 * research.
 */
export class FixtureEnricher implements Enricher {
  readonly name = 'fixture-enricher'

  constructor(
    private readonly override?: Partial<EnrichmentResult>,
    private readonly error?: Error,
  ) {}

  async enrichSheet(input: {
    tiles: number
  }): Promise<import('./enricher').SheetEnrichment[]> {
    if (this.error) throw this.error
    return Array.from({ length: input.tiles }, (_, i) => ({
      n: i + 1,
      title: null,
      category: null,
      condition: 'good',
      // A recorded figure, never a researched one, and the caller marks it
      // unconfirmed for exactly that reason.
      priceCents: 4000,
      description: 'Demo mode: this write-up is a placeholder, not research.',
    }))
  }

  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    if (this.error) throw this.error

    return {
      productName: null,
      manufacturer: null,
      model: null,
      category: input.category,
      condition: 'good',
      conditionNotes: 'Some wear consistent with use. Nothing broken that I can see.',
      title: input.title,
      description:
        `${input.title}. Used, in working order, with normal marks from being stored.\n\n` +
        'Collection only. Happy to answer questions or send more photos.',
      lowCents: 2000,
      highCents: 6000,
      recommendedCents: 4000,
      priceBasis: 'Demo mode: this figure is a placeholder, not research.',
      confidence: 0.4,
      sources: [],
      searchQueries: [],
      unsourced: true,
      ...this.override,
    }
  }
}
