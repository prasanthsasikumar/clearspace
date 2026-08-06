import { z } from 'zod'

/**
 * Environment is parsed once, at import, and fails loudly. Every module reads
 * configuration from here rather than touching `process.env` directly, so the
 * set of knobs the app responds to is enumerable in one place.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Unset means demo mode: the app runs against recorded fixtures. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  BLOB_DRIVER: z.enum(['disk']).default('disk'),
  BLOB_DIR: z.string().default('./storage'),

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

/**
 * True when no Gemini key is configured. The app stays fully explorable in this
 * mode — detection replays recorded fixtures instead of calling the API.
 */
export const isDemoMode = !env.GEMINI_API_KEY
