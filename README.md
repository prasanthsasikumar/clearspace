# Sorta

Point a phone at a room. Get a sellable inventory.

Sorta is an inventory and marketplace-listing assistant for people clearing out
storage units, garages, estates, and houses. The bottleneck in liquidation is
not selling — it is cataloguing. Photographing, identifying, pricing, and
writing up each item costs 10–20 minutes, so a 60-item storage unit is a lost
weekend. Most people dump the lot to a liquidator for pennies instead.

Sorta starts from the **room**, not the item: one wide photo, a set of boxes
drawn over everything sellable in it, and one tap per thing worth listing.

## Status

**Phase 1 is complete and real.** Capture → detect → review → promote →
inventory works end to end, with tests. Phases 2 and 3 are fully specified in
[`docs/superpowers/specs/2026-08-06-sorta-design.md`](docs/superpowers/specs/2026-08-06-sorta-design.md)
and not yet built.

| Phase | Contents | State |
|---|---|---|
| 1 | Capture, object detection, review canvas, promote-to-item, inventory, photo shot list | **Built** |
| 2 | AI product identification, listing description generation | Specified |
| 3 | Pricing research, marketplace CSV/ZIP export | Specified |

## Running it

```bash
npm install
npm run db:push     # applies migrations to an embedded Postgres
npm run seed        # optional: a demo lot with detections to tap
npm run dev
```

Open `http://localhost:3000`. On a phone, open the same URL over your LAN —
the capture screen uses the rear camera directly.

**No API key and no database are required to start.** With `GEMINI_API_KEY`
unset the app runs in demo mode against recorded detections, exercising the
same job queue, crop pipeline, and UI as production. To use the real model,
copy `.env.example` to `.env.local` and set the key.

```bash
npm test            # 95 tests: pure domain logic + integration against real Postgres
npm run typecheck
npm run build
```

## How it is put together

One Next.js app, layered so the vendors are replaceable:

```
Browser (mobile Safari PWA)
  ├─ Capture — file input · getUserMedia · client-side video keyframes
  ├─ Review  — canvas overlay, tap-to-promote, drag-to-add
  └─ fetch → Route Handlers
        │
   src/services/   orchestration
   src/domain/     pure logic, zero I/O  ← geometry, coverage rules, status machine
   src/ai/         VisionProvider  → Gemini | recorded fixtures
   src/storage/    BlobStore       → local disk | S3-shaped
   src/db/         Drizzle         → PGlite (WASM) | Neon
   src/jobs/       Postgres-backed queue + in-process poller
```

### Four decisions worth knowing about

**PGlite, not a hosted database.** Real Postgres compiled to WASM, running
in-process — genuine `jsonb`, arrays, and enums with no Docker and no signup.
Setting `DATABASE_URL` swaps in Neon or Supabase with no other change. The
cost: PGlite is single-process, so it is a development and MVP database, not a
production deploy target.

**Video is decomposed in the browser.** Seeking an `HTMLVideoElement` and
drawing to a canvas avoids an ffmpeg dependency entirely. Frames are scored for
sharpness and spacing on-device, so a 90 MB walkthrough uploads as eight sharp
frames instead. Images get the same treatment — decoded, downscaled, and
re-encoded to JPEG before upload, which also solves iPhone HEIC.

**Detections are not items.** Promotion is an explicit tap. That is what makes
"14 objects found, promote the 6 worth selling" honest, and it keeps dismissals
as a signal rather than throwing them away.

**One coordinate contract.** Every bounding box — from Gemini, from a future
SAM 2 adapter, or from a finger dragged across the canvas — is stored as
normalized fractions of the image, origin top-left. Pixels exist only at the
two edges of the system: the crop service and the renderer.

## What Phase 1 deliberately does not do

- **No authentication.** A single implicit local user; every query is already
  scoped by `user_id`, so adding a session lookup is additive.
- **No estimated values.** Items show "Not yet priced" rather than a made-up
  number. Honest pricing needs the Phase 3 research pipeline.
- **No segmentation masks.** Detection returns boxes only. Asking Gemini for
  base64 masks alongside 15 objects risks a truncated response and thus a
  total detection failure; per-object masks belong in Phase 2, on demand. The
  schema and renderer already carry mask support for when they land.
- **No offline queue.** It matters — storage units have bad signal — but it is
  a Phase 2 concern once the core loop is proven.

## Design

The interface is built for someone standing in a concrete box lit by one bulb,
holding the phone one-handed. High ink contrast, hairline structure instead of
shadow, 44 px minimum targets, one signal colour so "this needs your attention"
is never ambiguous, and mono labels for the metadata a catalogue is made of.
Tokens live in [`tokens.css`](tokens.css).
