import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/**
 * Next.js loads `.env.local` itself, but the migrate and seed scripts run under
 * bare `tsx` and would silently fall back to demo mode without it, which looks
 * exactly like a working run, just against fixtures. Loading it here means one
 * place decides what configuration exists, whichever entrypoint is running.
 */
function loadLocalEnvFile(): void {
  // Never under test. A suite that quietly picks up a real key stops being a
  // test suite and starts being a bill, and an intermittent one, since it
  // would then depend on a network.
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return
  if (process.env.GEMINI_API_KEY !== undefined) return
  const file = path.join(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  process.loadEnvFile(file)
}

loadLocalEnvFile()

/**
 * Environment is parsed once, at import, and fails loudly. Every module reads
 * configuration from here rather than touching `process.env` directly, so the
 * set of knobs the app responds to is enumerable in one place.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Unset means demo mode: the app runs against recorded fixtures. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /**
   * An alias rather than a pinned version on purpose. Google retires pinned
   * models for new keys, and the failure is a hard 404 on every detection;
   * an app that stops working because a default went stale is worse than one
   * whose model quietly improves. Pin via GEMINI_MODEL when stability matters
   * more than staying alive.
   */
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),

  BLOB_DRIVER: z.enum(['disk', 'supabase']).default('disk'),
  BLOB_DIR: z.string().default('./storage'),

  /* Supabase Storage. Required when BLOB_DRIVER=supabase. */
  SUPABASE_URL: z.string().url().optional(),
  /** Service-role key: server-side only. Never expose this to the browser. */
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  SUPABASE_BUCKET: z.string().default('clearspace'),

  /*
   * Auth. These two are public by design: the anon key is a scoped,
   * RLS-bound token meant to ship in the browser bundle. Unset means auth is
   * off and the app runs as a single local user, which is what keeps a fresh
   * clone usable with no accounts at all.
   */
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),

  /**
   * Shared secret for /api/jobs/tick. Unset is fine locally; on any host with
   * a scheduler in front of it this must be set, or anyone can make the app
   * spend money on model calls.
   */
  CRON_SECRET: z.string().min(1).optional(),

  /**
   * `inline` runs the queue in-process (local dev). `external` expects
   * something to call /api/jobs/tick, the only thing that works on a
   * serverless host, where no process survives between requests.
   */
  WORKER_MODE: z.enum(['inline', 'external']).optional(),

  /** Set to use a hosted Postgres; omitted means embedded PGlite. */
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DIR: z.string().default('./.data/pgdata'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(`Invalid environment configuration:\n${issues}`)
}

export const env = parsed.data

if (env.BLOB_DRIVER === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)) {
  throw new Error(
    'BLOB_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY. ' +
      'Failing at boot beats failing on the first photo upload.',
  )
}

/**
 * True when no Gemini key is configured. The app stays fully explorable in this
 * mode: detection replays recorded fixtures instead of calling the API.
 */
export const isDemoMode = !env.GEMINI_API_KEY

/**
 * True when Supabase Auth is configured. When it is not, every request runs as
 * one implicit local user; a fresh clone should be fully usable before anyone
 * signs up for anything.
 */
export const isAuthEnabled = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
)
