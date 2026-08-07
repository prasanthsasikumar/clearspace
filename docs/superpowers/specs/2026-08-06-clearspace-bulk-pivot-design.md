# Clearspace: Bulk-Capture Pivot

**Date:** 2026-08-06
**Status:** Approved. Stage A in implementation.
**Supersedes the core loop in:** [`2026-08-06-clearspace-design.md`](2026-08-06-clearspace-design.md)
(architecture, ports, and data model from that spec still hold)

## Why the loop inverts

Phase 1 asked the user to tap every object worth selling. That is one deliberate
decision per item, and people clearing out a storage unit do not want to make
sixty deliberate decisions; they want to walk around taking photos and be
handed something finished.

So the obligatory action moves from **selecting** to **pruning**. Everything the
user does now subtracts from a result rather than assembling one.

```
30 photos in ──▶ detect (per photo) ──▶ group across photos ──▶ auto-create items
                                                                      │
                     ◀── prune & fix ◀── enrich (identify+price+copy) ◀┘
                            │
                            └──▶ share sheet (per item) · CSV + ZIP (per lot)
```

## What this makes hard

One genuinely new problem: **the same physical object appears in several
photos.** A chair shot from the doorway, again from the side, again while the
user was aiming at the shelf behind it is *one listing with three views*, not
three listings. Getting this wrong in either direction is bad: over-merging
loses inventory, under-merging produces a duplicate-riddled list that is worse
than no list.

### Approach: shard cheaply, adjudicate with the model

**Stage 1: bucket by category.** Only compare a chair to a chair. Turns an
O(n²) visual comparison into small independent buckets and costs nothing.

**Stage 2: Gemini adjudicates each bucket.** Send the numbered crops in one
call: *"which of these are the same physical object photographed more than
once?"* The model returns groups of indices.

Two constraints are enforced in code, not asked of the model, because they are
structural facts rather than judgements:

1. **Two detections from the same photo are never the same object.** Two chairs
   in one frame are two chairs. Any group the model returns containing two
   detections from one scan is split along that line.
2. **Groups never cross a category boundary.** Guaranteed by the bucketing, and
   re-asserted when groups are applied.

Buckets larger than 20 crops are chunked; groups that share a member across
chunks merge transitively.

### Why not embeddings

Google's multimodal embedding endpoint is Vertex-only: it needs a GCP project
and a service account, not the API key this project runs on. A local CLIP via
transformers.js is a ~90 MB download and slow on CPU for fifty crops. Gemini is
already looking at these images and is good at this comparison.

The decision is isolated behind an `ObjectMatcher` port, so an embedding-based
matcher (and the vector search the original brief wanted) drops in later without
touching the service that calls it.

## Enrichment: two calls per item

**This corrects an earlier claim in this document.** The original design said
one structured call with Google Search grounding would do all three jobs.
Measured against a real key, it will not:

| Attempt | Result |
|---|---|
| `responseSchema`, no search | Clean JSON, **zero sources**; the price is invented |
| `googleSearch` **and** `responseSchema` | Accepted, clean JSON, **zero grounding chunks, zero web queries**; search silently never ran |
| `googleSearch` alone | **Real sources and real queries**, but prose rather than JSON |

The middle row is the dangerous one. The API accepts the combination, returns
perfect JSON, and quietly does no searching, producing a confident price that
*looks* sourced and is not. That is exactly the failure this project's first
principle forbids, and nothing in the response indicates it happened.

So enrichment is two calls:

1. **Research**: search on, no schema. Actually queries the web and returns
   prose plus `groundingMetadata` carrying the pages it read.
2. **Structure**: schema on, no search. Turns that prose into the listing,
   instructed to introduce no brand, model, or price the research did not
   support.

The sources stored against a valuation are therefore pages genuinely retrieved,
not citations composed after the fact. When the research pass returns nothing,
the valuation records `unsourced` and the UI says so in those words.

Enrichment is **on demand per lot**, not automatic on grouping. A big lot would
otherwise bill for sixty listings when the user meant to sell twelve.

Rough cost for a 30-photo lot: 30 detection calls + ~4 grouping calls + ~36
enrichment calls ≈ **70 calls**, run concurrently through the existing queue.

## Pricing stays honest

Search-grounded price estimates are informed guesses, not verified comparables;
sold-listing data is thin in a general web index. The app says so:

- Every `valuation` stores its `method` and its `comparables` with URLs.
- The UI shows *"Suggested $450, 4 sources"*, and the sources are tappable.
- An item carries `listingUnconfirmed` until the user has opened it.
- Lot-level CSV export reports how many prices were never checked.

This follows the principle from the original spec: never fabricate a fact about
someone's property. A sourced estimate labelled as an estimate is honest; the
same number presented as a valuation is not.

## Export

There is no public listing API for individual sellers on Facebook Marketplace,
OfferUp, or Craigslist. Facebook's bulk catalog upload is a Commerce Manager
feature for approved business partners. eBay is the exception, with real Sell
APIs and a genuine bulk-upload path.

So "one click" is the **iOS share sheet**, not an API call:

```js
navigator.share({ files: photoFiles, text: `${title}\n\n${description}\n\n$${price}` })
```

One tap hands the user their item's photos plus the generated copy. From there
they Save to Photos or share straight into the Facebook app and paste. No
accounts, no OAuth, works today. Where the Web Share API is unavailable, the
same button falls back to a photo download plus copy-to-clipboard.

Per lot: an eBay File Exchange CSV, a generic CSV, and a ZIP of all photos.

## Schema changes

Additive to the Phase 1 model. The `identifications`, `valuations`, and
`listings` tables built earlier now get used as designed.

| Change | Purpose |
|---|---|
| `scans.batch_id` (uuid, indexed) | Photos uploaded together group together. Grouping runs per batch. |
| `detections.crop_blob_key` | The crop is cut once, during detection. It feeds the matcher *and* becomes the item's view; cutting it twice would be waste. |
| `item_photos.source_detection_id` | A view traces back to the crop and photo it came from, so "where did this picture come from" is answerable. |
| `items.listing_unconfirmed` (bool) | Stage B. Gates the honesty badge and the export warning. |

New job types: `group_objects` (per batch), `enrich_item` (per item).

### Fan-in

A batch's detection jobs finish at different times. When a `detect_objects` job
completes it checks whether any sibling jobs for the same batch are still
outstanding; the last one out enqueues `group_objects`. This is the same
pattern already used to decide when a video scan is complete.

## Item lifecycle, revised

```
grouped ──▶ detected ──(enrich)──▶ ai_identified ──▶ needs_confirmation ──▶ confirmed ──▶ listed
   └──▶ discarded  (the prune action)
```

Auto-created items land in `detected`. The existing status machine and its
transition guards are unchanged.

## What survives from Phase 1

Everything structural: the ports, the job queue, the coordinate contract, the
crop pipeline, the status machine, the coverage rules, the whole test suite.

The **scan review canvas is demoted, not deleted.** It stops being the main path
and becomes "fix a miss on this photo", reachable from a batch when the user
notices something absent. Deleting it would re-open the failure the original
design called out: a pipeline that dead-ends when the detector misses something.
Tap-to-promote still works there; it is simply no longer required.

## Build order

**Stage A: the new core loop.** Bulk capture, cross-photo grouping,
auto-created items carrying every view. This is the risky stage: if grouping is
unreliable the premise wobbles, so it ships first and gets looked at against
real photographs before anything is built on top of it.

**Stage B: enrichment.** Identify, price, write copy. One call per item,
on demand per lot, sourced and labelled.

**Stage C: export.** Share sheet, eBay File Exchange CSV, generic CSV, ZIP.

## Testing

- **Grouping domain logic**: pure unit tests over the guard rails: same-photo
  splitting, cross-category rejection, transitive merging across chunks,
  malformed model output (missing indices, duplicated indices, out-of-range).
- **Batch pipeline**: integration against real Postgres: upload N photos,
  drain the queue, assert one item per distinct object with the right number of
  views attached, and assert two objects in the same photo stay separate.
- **Matcher adapter**: parsing and index-mapping against recorded fixtures.

## Deliberate omissions in Stage A

- **No re-grouping after the fact.** If the user merges or splits items by hand
  that is a manual edit, not a re-run of the matcher. Incremental re-clustering
  as new photos arrive is a real feature and a later one.
- **No cross-batch grouping.** Photos uploaded in two separate sessions produce
  two independent groupings. Merging across sessions needs the incremental
  design above.
- **No confidence score on a group.** The model returns groups, not
  probabilities, and a fabricated confidence would be worse than none.
