import { assertSafeKey, type BlobData, type BlobStore, type StoredBlob } from '@/storage'

/** The disk store's contract, held in a Map. Keeps test runs off the filesystem. */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, BlobData>()

  async put(key: string, data: Buffer, contentType: string): Promise<StoredBlob> {
    assertSafeKey(key)
    this.blobs.set(key, { data, contentType })
    return { key, contentType, byteSize: data.byteLength }
  }

  async get(key: string): Promise<BlobData | null> {
    assertSafeKey(key)
    return this.blobs.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key)
  }

  url(key: string): string {
    return `/api/blobs/${key}`
  }

  get size(): number {
    return this.blobs.size
  }
}
