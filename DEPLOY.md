# Deploying Sorta

Target: **Vercel** for the app, **Supabase** for Postgres and photo storage.

Netlify can host it too, but Vercel is the native Next.js target and `sharp`
works there without argument. The rest of this assumes Vercel.

## Why it cannot just be pushed

Three things in the local build depend on a machine that stays alive, and two
of them fail silently:

| Local | Serverless | Fix |
|---|---|---|
| PGlite writes to `./.data` | Filesystem is ephemeral — the database vanishes | `DATABASE_URL` → Supabase |
| Photos write to `./storage` | Same — uploads disappear | `BLOB_DRIVER=supabase` |
| Queue is a `setInterval` | Nothing survives between requests, so jobs are **enqueued and never run** — the UI sits at "Analysing…" forever with no error | Vercel Cron → `/api/jobs/tick` |

The third is the one worth understanding. Detection, grouping, and enrichment
all happen on a queue. Without something calling `/api/jobs/tick`, uploads
succeed and nothing ever processes them.

## 1. Supabase

**Storage.** `npm run setup:supabase` creates the private `sorta` bucket and
round-trips a test object through it. Safe to re-run.

**Database.** Dashboard → **Connect** → **Transaction pooler** (port **6543**,
not 5432). Serverless opens a connection per invocation and will exhaust the
direct limit; the pooler exists for exactly this.

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Then apply the schema:

```bash
npm run setup:supabase     # bucket + migrations + verification
```

No SQL to write — the schema comes from `drizzle/`.

> The client is configured with `prepare: false` and `max: 1`. pgbouncer in
> transaction mode does not share prepared statements across pooled
> connections, and leaving `prepare` on produces intermittent "prepared
> statement already exists" errors under concurrency.

## 2. Vercel

Import `prasanthsasikumar/sorta`. Framework and build command are detected.

### Environment variables

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** string, port 6543 |
| `BLOB_DRIVER` | `supabase` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Settings → API → `service_role` |
| `SUPABASE_BUCKET` | `sorta` |
| `GEMINI_API_KEY` | your key — omit to deploy in demo mode |
| `GEMINI_MODEL` | `gemini-flash-latest` |
| `CRON_SECRET` | any long random string |

`WORKER_MODE` is detected automatically: `external` on Vercel and Netlify,
`inline` locally. Set it explicitly only to override.

### The queue

`vercel.json` already registers the cron:

```json
{ "crons": [{ "path": "/api/jobs/tick", "schedule": "* * * * *" }] }
```

Vercel sends `Authorization: Bearer $CRON_SECRET`, which the endpoint verifies
with a constant-time comparison. **Set `CRON_SECRET`** — without it the
endpoint is open, and every job it runs can spend money on model calls.

Each invocation drains until the queue is empty or it runs out of time
(50s of a 60s budget), rather than a fixed number of jobs — detection takes
about 4s and enrichment about 30s, so a fixed count would either waste the
invocation or overrun it.

**Expect latency.** Cron granularity is one minute, so a batch may sit up to a
minute before anything starts, and a 30-photo upload takes a few invocations.
That is a real cost of the free tier, not a bug. To make it immediate, run the
same drain loop somewhere always-on (Railway, Fly, a small VM) hitting
`/api/jobs/tick` every few seconds, and drop the cron.

## 3. Verify, in this order

1. **`/`** loads and lists lots → the database is connected.
2. **Create a lot, upload two photos** → uploads land.
3. Check the Supabase **Storage** browser → objects appear under `scans/`.
4. Wait for the cron, or call it by hand:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/jobs/tick
   ```
   → `{"processed":2,...}`.
5. The batch screen reaches **complete** and items appear.

If step 5 stalls at "Analysing…", the queue is not being called — check
`CRON_SECRET` matches and the cron is registered under Vercel → Settings →
Cron Jobs.

## Costs worth knowing

A 30-photo lot is roughly 30 detection calls + ~4 grouping calls, then ~2 calls
per item you ask it to write up. Enrichment is deliberately on demand for this
reason — grouping does not trigger it.

## Auth

Anyone can use Sorta without an account; signing in is what makes the work
survive a cleared cache and follow them to another device.

The mechanism: middleware signs a first-time visitor in **anonymously** before
anything renders, so their lot is persisted server-side from the first upload.
Adding an email or linking Google later keeps the **same Supabase user id**, so
nothing is migrated at the moment they commit — which is exactly the moment you
cannot afford to lose someone's work.

### Dashboard toggles

| Where | Setting | Needed |
|---|---|---|
| Authentication → Sign In / Providers | **Anonymous sign-ins** → on | Yes — without it, first-time visitors hit the sign-in wall instead of the app |
| Authentication → Sign In / Providers | **Email** | Already on |
| Authentication → Sign In / Providers | **Google** → on, + client ID/secret from Google Cloud | Only for the Google button |
| Authentication → URL Configuration | **Redirect URLs** → add `http://localhost:3300/auth/callback` and `https://<app>/auth/callback` | Yes — the magic link and OAuth both return here |

Google needs an OAuth client from Google Cloud Console (Web application), with
`https://<ref>.supabase.co/auth/v1/callback` as the authorised redirect URI.
Until it is configured the button is present and returns a clear error rather
than failing silently.

### Environment

Auth is off unless both of these are set, and with it off the app runs as a
single implicit local user — which is what keeps a fresh clone usable:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API → `anon` / publishable |

## Not done

- **eBay publishing** — the button exists and is disabled.
- **Photo ZIP export** — the Facebook CSV and per-item share sheet are built.
- **Passwords** — email sign-in is a magic link only. Nothing to invent or
  forget, and no password reset flow to build.
- **Account deletion / export** — no self-serve way to remove an account yet.
