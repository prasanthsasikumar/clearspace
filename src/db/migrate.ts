import path from 'node:path'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import type { Database } from './client'

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle')

/**
 * Applies generated migrations to whichever driver is behind `Database`.
 *
 * The two migrator entrypoints are driver-specific and their parameter types
 * do not unify, so the cast is confined to this one function rather than
 * leaking a driver-shaped type into the rest of the app.
 */
export async function applyMigrations(
  db: Database,
  driver: 'pglite' | 'postgres',
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const runner = driver === 'pglite' ? migratePglite : migratePostgres
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runner(db as any, { migrationsFolder })
}
