import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import postgres from 'postgres'
import { env } from '@/config/env'
import * as schema from './schema'

/**
 * The application depends on this type, not on a concrete driver. PGlite backs
 * local development; setting DATABASE_URL swaps in a hosted Postgres with no
 * other change anywhere in the codebase.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export function createPgliteDatabase(client: PGlite): Database {
  return drizzlePglite(client, { schema }) as unknown as Database
}

/**
 * Hosted Postgres, configured for a connection pooler.
 *
 * Supabase (and every other serverless-friendly Postgres) puts pgbouncer in
 * front in transaction mode, where prepared statements are not shared across
 * pooled connections — leaving `prepare` on produces "prepared statement
 * already exists" errors under any real concurrency, intermittently, which is
 * the worst way to find out. `max: 1` because each serverless invocation is
 * its own short-lived process and holding a pool per invocation is how you
 * exhaust the pooler.
 */
export function createPostgresDatabase(url: string): Database {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    // Idempotent DDL emits "already exists, skipping" NOTICEs on every boot.
    // postgres.js prints those to stderr, where they read exactly like
    // failures — which is how people learn to ignore the log that will
    // eventually carry a real one.
    onnotice: (notice) => {
      if (notice.severity === 'NOTICE' && notice.code?.startsWith('42P')) return
      console.warn('[db]', notice.severity, notice.message)
    },
  })
  return drizzlePostgres(sql, { schema }) as unknown as Database
}

/**
 * Next.js dev-mode hot reloading re-evaluates modules, and a second PGlite
 * instance pointed at the same data directory fails to acquire its lock. The
 * connection is parked on globalThis so reloads reuse it.
 */
const globalForDb = globalThis as unknown as {
  __clearspaceDb?: Database
  __clearspacePglite?: PGlite
}

function initDatabase(): Database {
  if (env.DATABASE_URL) return createPostgresDatabase(env.DATABASE_URL)

  // PGlite creates its data directory but not the parents of it.
  mkdirSync(path.dirname(path.resolve(env.PGLITE_DIR)), { recursive: true })

  const client = globalForDb.__clearspacePglite ?? new PGlite(env.PGLITE_DIR)
  globalForDb.__clearspacePglite = client
  return createPgliteDatabase(client)
}

export function getDb(): Database {
  if (!globalForDb.__clearspaceDb) {
    globalForDb.__clearspaceDb = initDatabase()
  }
  return globalForDb.__clearspaceDb
}

/** The raw PGlite handle, when running embedded. Used by the migrator. */
export function getPgliteClient(): PGlite | undefined {
  return globalForDb.__clearspacePglite
}

export { schema }
