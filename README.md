# Clearspace

Photograph a space. Get listings.

Clearspace is for people clearing out storage units, garages, estates, and houses.
The bottleneck in liquidation is not selling — it is cataloguing. Photographing,
identifying, pricing, and writing up each item costs 10–20 minutes, so a 60-item
unit is a lost weekend, and most people hand the lot to a liquidator for pennies
instead.

So the user's only real job is **pruning**. Walk around taking photos badly,
hand them over, bin what you do not want to sell. Everything else happens
without you.

```
photos in ──▶ detect per photo ──▶ match the same object across photos ──▶ drafts
                                                                            │
        share sheet / CSV ◀── approve ◀── written listing + sourced price ◀──┘
```

## Status

| Stage | Contents | State |
|---|---|---|
| 1 | Capture, object detection, review canvas, inventory | **Built** |
| A | Bulk capture, cross-photo grouping, auto-created drafts | **Built** |
| B | Identification, sourced pricing, written listings | **Built** |
| C | Facebook catalogue CSV, iOS share sheet | **Built** |
| — | eBay publishing, photo ZIP, offline queue, auth | Not built |

167 tests — pure domain logic plus integration against real in-process Postgres.

## Running it

```bash
npm install
npm run db:push          # migrations into an embedded Postgres
npm run seed             # optional demo lot
npm run dev -- -p 3300
```

On a phone, open the same URL over your LAN. Capture uses `<input capture>`
rather than `getUserMedia`, so the camera works over plain HTTP.

**No API key and no database are needed to start.** With `GEMINI_API_KEY` unset
the app replays recorded responses through the same queue, crop pipeline, and UI
as production. For real detection and pricing, copy `.env.example` to
`.env.local` and set the key.

```bash
npm test && npm run typecheck && npm run build
```

## How it is put together

```
Browser (mobile-first PWA)
  ├─ Capture — bulk photo picker · video decomposed to keyframes on-device
  ├─ Board   — two-up triage, preselected, tap to drop
  ├─ Listings— progress, approve, provenance, export
  └─ fetch → Route Handlers
        │
   src/services/   orchestration
   src/domain/     pure logic, zero I/O  ← geometry, grouping, export, status
   src/ai/         VisionProvider · ObjectMatcher · Enricher  → Gemini | fixtures
   src/storage/    BlobStore   → local disk | S3-shaped
   src/db/         Drizzle     → PGlite (WASM) | Neon via DATABASE_URL
   src/jobs/       Postgres-backed queue + in-process poller
```

### Five decisions worth knowing about

**Grounding and structured output cannot be combined.** Gemini accepts
`googleSearch` and `responseSchema` in one request and then silently does not
search — flawless JSON, zero sources, an invented price wearing the costume of a
researched one. Enrichment is therefore two calls: a grounded research pass, then
a structuring pass over what it found. Sources stored against a valuation are
pages actually retrieved. When research finds nothing, the item says `unsourced`
in those words rather than presenting a guess in the same typeface as a fact.

**Failure biases toward duplicates, never toward loss.** Cross-photo grouping
enforces two rules in code rather than asking the model: two detections in one
photograph are never the same object, and groups never cross a category. If the
matcher dies, every crop becomes its own listing. A duplicate is visible and
deletable; an item silently merged away is neither.

**One photo is enough.** Photo coverage does not gate anything. Someone with
five minutes in a unit often has exactly one picture of a thing, and answering
that with "Photos needed" refuses the job. The shot list survives as advice.

**PGlite, not a hosted database.** Real Postgres compiled to WASM, in-process,
no Docker and no signup. `DATABASE_URL` swaps in Neon with no other change. The
cost: single-process, so it is a development and MVP database.

**Everything expensive happens on the phone.** Images are decoded, downscaled,
scored for sharpness, and re-encoded to JPEG before upload — which also solves
iPhone HEIC. Video is seeked and drawn to a canvas, so a 90 MB walkthrough
uploads as eight sharp frames and there is no ffmpeg dependency.

## Exporting, honestly

There is **no public API for posting a personal Facebook Marketplace, OfferUp,
or Craigslist listing**. Facebook's bulk import is the Commerce Manager
catalogue feed and needs a business catalogue.

So there are two paths, and the app is explicit about which is which:

- **Share** (per item) — photos plus the generated copy into the iOS share
  sheet. Save to Photos, or send straight into the Facebook app and paste. This
  is the real one-tap route for a private seller.
- **Export CSV** (per lot) — Facebook's catalogue feed to its documented spec.
  Useful if you have a Commerce Manager catalogue. Unpriced and photo-less items
  are skipped rather than exported at zero, and the export reports how many
  prices nobody has checked.

`image_link` and `link` are built from the origin you reached the app on, so a
feed made from `localhost` will not resolve for anyone else.

## Design

Built for someone in a concrete box lit by one bulb, holding the phone
one-handed. High ink contrast, hairline structure instead of shadow, 44 px
minimum targets on touch, one signal colour so "this needs you" is never
ambiguous, mono labels for catalogue metadata. Tokens in [`tokens.css`](tokens.css).

Specs: [original design](docs/superpowers/specs/2026-08-06-clearspace-design.md) ·
[bulk-capture pivot](docs/superpowers/specs/2026-08-06-clearspace-bulk-pivot-design.md).
