import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assertSafeKey,
  extensionForMime,
  type BlobData,
  type BlobStore,
  type StoredBlob,
} from './blob-store'

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
  csv: 'text/csv',
}

export class LocalDiskBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key)
    const resolved = path.resolve(this.root, key)
    const rootResolved = path.resolve(this.root)
    // Defence in depth: even with a validated key, confirm we stayed inside.
    if (!resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`Blob key escapes storage root: ${key}`)
    }
    return resolved
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredBlob> {
    const filePath = this.resolve(key)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, data)
    return { key, contentType, byteSize: data.byteLength }
  }

  async get(key: string): Promise<BlobData | null> {
    const filePath = this.resolve(key)
    try {
      const data = await readFile(filePath)
      const ext = path.extname(filePath).slice(1).toLowerCase()
      return { data, contentType: MIME_BY_EXTENSION[ext] ?? 'application/octet-stream' }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key)
    try {
      await unlink(filePath)
    } catch (error) {
      // Deleting an already-absent blob is not an error worth propagating.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  url(key: string): string {
    assertSafeKey(key)
    return `/api/blobs/${key}`
  }
}

export { extensionForMime }
