import { getObjectMatcher, getVisionProvider } from '@/ai'
import { getDb, type Database } from '@/db/client'
import { registerJobHandlers } from '@/jobs/handlers'
import { getBlobStore } from '@/storage'
import type { JobContext } from '@/jobs/worker'
import type { BlobStore } from '@/storage'
import type { VisionProvider } from '@/ai/vision-provider'
import type { ObjectMatcher } from '@/ai/object-matcher'

export interface AppContext extends JobContext {
  db: Database
  blobs: BlobStore
  vision: VisionProvider
  matcher: ObjectMatcher
}

/**
 * The dependency bundle every route handler and job shares.
 *
 * Route handlers take this rather than importing `getDb()` directly, which is
 * what lets the integration tests hand the same code an in-memory database and
 * a fixture vision provider without a single mock.
 */
export function getAppContext(): AppContext {
  registerJobHandlers()
  return {
    db: getDb(),
    blobs: getBlobStore(),
    vision: getVisionProvider(),
    matcher: getObjectMatcher(),
  }
}
