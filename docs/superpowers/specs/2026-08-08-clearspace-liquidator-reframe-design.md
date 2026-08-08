# Clearspace: reframing for estate liquidators

## Why this document exists

Clearspace was built for a private person clearing a storage unit. That person
is real, but they are a poor first customer: they clear out once, they have no
budget, and they cannot be found except by advertising.

An estate liquidator has the identical problem every single week, pays salaries
to solve it, and can be found in a public directory. Cataloguing is not an
inconvenience for them, it is their cost of goods. This document reframes the
product, the website, and the go-to-market around that buyer.

The decision to avoid self-storage operators is deliberate and worth recording.
Their profit comes from length of stay (existing-customer rate increases on
long-tenure tenants), so a tool whose pitch is "clearing out is easy now" argues
against the metric their asset managers are paid on. Their cleanout costs are
real, but they are a cost line inside a business whose revenue line we would
appear to attack. Storage is a referral channel later, not a customer now.

## Decisions taken

| Question | Decision |
|---|---|
| Beachhead segment | Estate and online liquidators |
| Where output goes | Online auction platform upload: lot CSV plus photo bundle |
| First platform | HiBid / Auction Flex |
| Consumer path | Kept, free, demoted below the professional framing |
| Distribution | Cold outreach, no warm contacts |
| Pricing | $0.50 per catalogued lot, first 25 free |

Approach chosen: build the thin auction-shaped layer **first**, then the
outreach artifact, then the website. The export format is not a feature added
after validation. It is the instrument the validation is performed with, since
the entire persuasive force of a cold artifact comes from the output looking
like something the recipient would have paid a cataloguer to produce.

## Section 1: the auction layer

### What already exists

The reframe is small because the schema was already most of the way there,
under different labels:

- `valuations.lowCents` / `highCents` / `recommendedCents` is an auction
  estimate range, currently flattened to a single Marketplace price on the way
  out.
- `itemCondition` already carries seven tiers.
- `identifications.sources` and `valuations.comparables` / `method` already
  carry the provenance an estimate needs to be defensible.
- `src/domain/export/` is already a generic RFC 4180 writer (`csv.ts`) with
  per-destination formatters beside it (`facebook.ts`, `marketplace.ts`).

Nothing in capture, detection, cross-photo grouping, or the two-call grounded
enrichment changes.

### What is missing

**`items.lotNumber`**: nullable integer, assigned at export.

**`items.reserveCents`**: nullable integer, distinct from the estimate.
Never model-generated under any circumstance. A reserve is a seller's
instruction with legal weight, and an invented one is a liability rather than a
convenience. It is set by a person or it is absent.

**`marketplace` enum**: add `auction`.

**`src/domain/export/auction.ts`**: a sibling formatter, pure, no I/O, built on
`csv.ts` in the same shape as `facebook.ts`.

**Photo bundle**: a ZIP of item photos named `{lotNumber}_{n}.jpg`, where `n`
is a 1-based index over that item's photos with the primary photo first, so
`12_1.jpg` is the lead image of lot 12. Built in `src/services/exports.ts`
alongside the CSV, from the same ordering pass.

### Lot numbering: assigned at export, not at detection

This is the one decision here with consequences.

Numbers are assigned when an export is built, over the exported set in
`items.createdAt` order, and then **persisted** to `items.lotNumber`. Items that
already carry a number keep it; newly included items continue from the current
maximum `lotNumber` within that lot.

The reason is that the CSV and the ZIP must never disagree. They are generated
from one ordering in one pass, so a photo filename cannot drift away from the
row that references it. Persisting the assignment additionally makes re-export
stable: a lot catalogued today and re-exported tomorrow after two more items
were added does not renumber the first forty, which matters once an auctioneer
has published a catalogue.

**Reordering lots is explicitly out of scope.** Auctioneers do reorder
constantly, but they do it inside Auction Flex, which is where the lots are
going anyway. Building a drag-and-drop ordering UI to feed software that has one
would be work spent twice.

### Column mapping, and how to get it right

The existing formatters were written against the real vendor templates with
obsessive fidelity. `marketplace.ts` preserves an EN DASH in a dropdown value
because the validation sheet uses one and the help text does not. The auction
formatter is held to the same standard.

**Therefore the first implementation step is to obtain an actual HiBid /
Auction Flex lot import template and write the formatter against that file.**
The list below is the field set to map, not a guess at literal header names:

lot number · title · description · condition · low estimate · high estimate ·
reserve · category · quantity · photo filenames

Any field the real template requires and Clearspace cannot supply is reported
through the existing `skipped` / `warnings` mechanism rather than sent as a
blank the upload will reject.

### Estimates, and refusing to guess

The auction export reads `valuations.lowCents` / `highCents` directly. It does
**not** synthesise a range from `estimatedValueCents` by applying a spread. An
item with no valuation is skipped with "no estimate yet" as its reason, in
keeping with the rule the app already follows elsewhere: when research finds
nothing, the item says `unsourced` in those words rather than presenting a guess
in the same typeface as a fact.

`exportReadiness` in `src/domain/export-readiness.ts` gains an auction variant,
because its current blockers encode Marketplace's requirements (title, price,
condition) and the auction file needs an estimate range instead of a price.

### Testing

Follows the existing split: pure domain tests plus integration against the
in-process Postgres.

- Domain: numbering assignment and continuation, skip reasons, condition
  mapping, CSV escaping of descriptions containing quotes and newlines.
- Integration: the invariant that **every photo filename referenced in the CSV
  exists in the ZIP, and every ZIP entry is referenced**. This is the single
  most valuable test in the change, because it is the failure the recipient
  would discover instead of us.
- Regression: the Facebook and Marketplace exports are untouched and their
  existing tests must still pass.

## Section 2: the website

### Routing

`/` is currently the lots index, and middleware establishes an anonymous
session before render, so there is no logged-out state to branch on. The lots
index moves to `/lots`, where `/lots/[lotId]` already lives, and `/` becomes the
marketing page. One file moves.

### What the page must do

Cold outreach puts no call in the loop, so the page carries the whole burden of
conversion. Three jobs, in order:

1. **Name the job in their vocabulary in the first line.** "Photograph a space,
   get listings" is the consumer sentence. The professional sentence is about
   lots, estimates, and cataloguing hours.
2. **Show a real catalogue rather than describing one.** The centre of the page
   is an actual lot: photos in, numbered lots out, estimate ranges with sourced
   comparables.
3. **Offer something to do that is not booking a call.** The anonymous session
   already built makes "upload photos of your next lot right now, no signup"
   true today, and it is a far better call to action than a contact form.

### Pricing, published

**$0.50 per catalogued lot, sold in packs, first 25 free.**

Anchored against what it replaces: a cataloguer at $20/hour spending 10–20
minutes a lot costs $3–7 per lot, so a 300-lot auction is $150 against roughly
$1,500 of staff time. The free block is what makes the trial call to action
real. The price is published rather than withheld because withholding forces
the call this channel cannot rely on.

### Design

`tokens.css` is tuned for one-handed use in a concrete box under a single bulb.
The website is read on a desktop in an office. Reuse the tokens for colour and
type so the two feel related; do not carry over the 44 px targets or the maximum
ink contrast, which solve a problem the website does not have.

### Copy is written last

The page structure and design system are built before outreach; the words are
written **after** the first five artifacts exist. By then there are real
sentences from real auctions to use instead of invented ones.

## Section 3: pilots and distribution

### Step zero: the calibration gate

The riskiest assumption in this plan is not the export format or the site. It is
that blind estimates land close enough to hammer prices that showing a firm the
comparison helps rather than harms. If calibration is poor, the artifact argues
against us: it hands an auctioneer evidence that our pricing is wrong.

Testing it costs one afternoon with the app exactly as it stands. Take one
completed HiBid estate auction, catalogue 20 lots from the published photos
without looking at the results, then compare.

- **Pass** (estimates mostly bracket the hammer price, no wild misses): build
  Section 1 as designed, and calibration goes on the website.
- **Fail**: the plan survives, the pitch narrows. Lead on cataloguing speed and
  completeness alone, and present estimates as a specialist's starting point
  rather than an answer. Cataloguing labour was always the thing being sold
  against; pricing accuracy was the bonus. The value of running this first is
  knowing not to put it on the site.

**Everything else is gated on this.**

### Target list

HiBid and AuctionZip publish completed auctions with photos and realized prices.
EstateSales.net covers tag-sale firms moving online. Filter for owner-operated
firms running photo-rich estate auctions across two or three metros. Target
roughly 30 names, small enough that every one is personalised.

### The artifact

Per firm: their own completed auction, catalogued blind from their published
photos, presented as a private one-to-one page showing their lots beside ours
and the time it took.

**Constraint, held firmly:** these stay private and one-to-one. Building a
personalised page from a firm's public listing photos and sending it to that
firm is ordinary business development. Republishing their photography on our
marketing site is not, and a public case study needs their written permission.

### What counts as signal

Not replies, and not sign-ups. One firm running a real upcoming auction through
Clearspace end to end, and telling us what broke.

## Sequencing

1. Calibration gate (one afternoon, no code)
2. Auction layer: schema, formatter, ZIP, readiness
3. Artifact generation for ~5 firms
4. Website structure, then copy written from those artifacts
5. Outreach to ~30 firms

## Explicitly out of scope

Staff seats, consignor records, commission splits, settlement statements,
billing integration, multi-platform export beyond HiBid, lot reordering UI, and
any change to the consumer path beyond its position on the website. These are
what the product becomes if this works, and designing them now would mean
guessing every detail from zero customer contact.

## Note on implementation planning

Sections 1 and 2 are buildable and belong in an implementation plan. Section 3
is operational (a target list, an outreach sequence, and a calibration
experiment) and is recorded here for context rather than to be coded.
