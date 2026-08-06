import { PGlite } from '@electric-sql/pglite'
import sharp from 'sharp'
import { createPgliteDatabase, type Database } from '@/db/client'
import { applyMigrations } from '@/db/migrate'
import { FixtureVisionProvider } from '@/ai/fixture-provider'
import { FixtureObjectMatcher } from '@/ai/fixture-matcher'
import type { VisionProvider } from '@/ai/vision-provider'
import type { ObjectMatcher } from '@/ai/object-matcher'
import { registerJobHandlers } from '@/jobs/handlers'
import { drain } from '@/jobs/worker'
import type { JobContext } from '@/jobs/worker'
import { MemoryBlobStore } from './memory-store'

export interface Harness extends JobContext {
  db: Database
  blobs: MemoryBlobStore
  vision: VisionProvider
  matcher: ObjectMatcher
  close(): Promise<void>
}

/**
 * A complete application context backed by an in-memory Postgres.
 *
 * PGlite runs real Postgres in-process, so integration tests exercise the
 * actual SQL, the actual constraints, and the actual enum types — no database
 * is mocked and no query is exercised in a dialect the app never speaks.
 */
export async function createHarness(
  options: { vision?: VisionProvider; matcher?: ObjectMatcher } = {},
): Promise<Harness> {
  const client = new PGlite()
  const db = createPgliteDatabase(client)
  await applyMigrations(db, 'pglite')

  registerJobHandlers()

  return {
    db,
    blobs: new MemoryBlobStore(),
    vision: options.vision ?? new FixtureVisionProvider(),
    matcher: options.matcher ?? new FixtureObjectMatcher(),
    async close() {
      await client.close()
    },
  }
}

/** Runs every queued job to completion, the way the poller eventually would. */
export async function drainJobs(harness: Harness): Promise<number> {
  return drain(harness, 50)
}

/**
 * A real JPEG of the requested size.
 *
 * The pipeline hands buffers to `sharp` for metadata and cropping, so tests
 * that use a fake byte string would pass while the real path throws. Making a
 * genuine image is cheap and keeps the test honest.
 */
export async function makeJpeg(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 128, b: 140 },
    },
  })
    .jpeg()
    .toBuffer()
}
