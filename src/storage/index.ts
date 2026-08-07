import { env } from '@/config/env'
import type { BlobStore } from './blob-store'
import { LocalDiskBlobStore } from './local-disk-store'
import { SupabaseBlobStore } from './supabase-store'

const globalForBlobs = globalThis as unknown as { __clearspaceBlobStore?: BlobStore }

export function getBlobStore(): BlobStore {
  if (!globalForBlobs.__clearspaceBlobStore) {
    globalForBlobs.__clearspaceBlobStore =
      env.BLOB_DRIVER === 'supabase'
        ? new SupabaseBlobStore({
            url: env.SUPABASE_URL!,
            serviceKey: env.SUPABASE_SERVICE_KEY!,
            bucket: env.SUPABASE_BUCKET,
          })
        : new LocalDiskBlobStore(env.BLOB_DIR)
  }
  return globalForBlobs.__clearspaceBlobStore
}

export * from './blob-store'
export { LocalDiskBlobStore } from './local-disk-store'
export { SupabaseBlobStore } from './supabase-store'
