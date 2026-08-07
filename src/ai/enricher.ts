import type { EnrichmentInput, EnrichmentResult } from './gemini/enrichment'

export type { EnrichmentInput, EnrichmentResult, EnrichmentSource } from './gemini/enrichment'

/**
 * Turns an item and its photographs into a listing with a sourced price.
 *
 * Its own port because the honest implementation is two model calls with
 * grounded search, and a future one might be an eBay comparables lookup with
 * no model at all. The service that calls this cares about neither.
 */
export interface Enricher {
  readonly name: string
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>
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
