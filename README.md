# Clearspace

**Photograph a space. Get listings.**

Clearing out a storage unit, garage, or estate is slow because of the
cataloguing, not the selling. Photographing, identifying, pricing, and writing
up each item takes 10–20 minutes. Clearspace does that part. You take photos of
everything, then bin what you don't want to sell.

![Adding photos, sorting them, checking listings, and one finished listing](docs/screenshots/flow.png)

## How it works

1. **Photograph the space.** Take as many photos as you like and don't worry
   about framing. A blurry shot gets a warning and still uploads.
2. **Clearspace sorts it out.** It finds every object in every photo. When the
   same object appears in more than one photo, it becomes a single draft.
3. **Prune.** Bin what you don't want to sell. Binned items can be brought back.
4. **Check and export.** Each listing has a title, description, and price
   estimate, with sources wherever the research found some. Share a listing to
   Facebook Marketplace through the phone's share sheet, or export the whole lot
   as a CSV.

![The lot board on desktop after pruning](docs/screenshots/board.png)

## Run it locally

```bash
npm install
npm run db:push          # migrations into an embedded Postgres (PGlite)
npm run seed             # optional demo lot
npm run dev -- -p 3300
```

Open **http://localhost:3300/lots**. The page at `/` is the marketing page.

**You don't need an API key or a database to try it.** With no
`GEMINI_API_KEY` set, the app replays recorded AI responses through the same
pipeline and UI. To run real detection and pricing, copy `.env.example` to
`.env.local` and add a Gemini key. For hosting (Supabase for storage, database,
and auth, deployed on Vercel), see [DEPLOY.md](DEPLOY.md).

To check a phone, open the same URL over your LAN. Capture uses
`<input capture>`, so the camera works over plain HTTP.

```bash
npm test && npm run typecheck && npm run build
```

## Stack

Next.js · React · Drizzle on PGlite or Postgres · Google Gemini · Supabase (optional)

```
src/domain/     pure logic, no I/O (geometry, grouping, export)
src/services/   orchestration
src/ai/         vision, matching, enrichment → Gemini or recorded fixtures
src/storage/    blob store → local disk or Supabase
src/db/         Drizzle schema and client
src/jobs/       Postgres-backed job queue
```

## Design notes

- **Prices are never made up.** When the research turns up no sources, the
  listing says so plainly and does not dress a guess up as a researched price.
  Gemini ignores search grounding if you also ask for structured output, so
  enrichment makes two calls: a grounded research pass, then a structuring pass.
- **A duplicate is better than a lost item.** Two objects in the same photo are
  never merged, and neither are objects from different categories. If matching
  fails, every detection becomes its own listing.
- **The phone does the heavy lifting.** Before upload, images are downscaled,
  scored for sharpness, and converted to JPEG, which also covers iPhone HEIC.
  Videos are turned into a few sharp keyframes in the browser.
- **Export works within what the marketplaces allow.** Facebook Marketplace,
  OfferUp, and Craigslist have no public API for personal listings. So each item
  goes out through the share sheet, and the CSV follows Facebook's catalogue
  feed spec for anyone who has a Commerce Manager catalogue.

More detail is in [`docs/`](docs/).
