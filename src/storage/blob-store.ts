/**
 * Blob storage port.
 *
 * Phase 1 writes to local disk. The interface is deliberately narrow (put,
 * get, delete, and a URL) so an S3 or Vercel Blob adapter is a drop-in
 * replacement without a signed-URL abstraction leaking into callers.
 */
export interface StoredBlob {
  key: string
  contentType: string
  byteSize: number
}

export interface BlobData {
  data: Buffer
  contentType: string
}

export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<StoredBlob>
  get(key: string): Promise<BlobData | null>
  delete(key: string): Promise<void>
  /** The path a browser fetches this blob from. */
  url(key: string): string
  /**
   * A one-shot target the browser can PUT straight to, or null when this
   * driver has no such thing.
   *
   * Routing an upload through the app costs the serverless function the whole
   * time the bytes are in flight, which on one bar of signal is most of the
   * time there is, and caps a batch at the request body limit. Sending them
   * to storage directly leaves the function to record what landed.
   *
   * Local disk returns null and callers fall back to posting the file, which
   * is what keeps `npm run dev` and the test suite working unchanged.
   */
  createUploadTarget?(
    key: string,
    contentType: string,
  ): Promise<{ url: string; headers: Record<string, string> } | null>
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/zip': 'zip',
  'text/csv': 'csv',
}

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? 'bin'
}

/**
 * Keys are date-partitioned so a directory listing stays navigable after a few
 * thousand uploads, and prefixed by kind so a future lifecycle policy can
 * expire scene photos without touching item photos.
 */
export function makeBlobKey(
  prefix: 'scans' | 'frames' | 'items' | 'masks' | 'exports',
  mimeType: string,
  now: Date = new Date(),
): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const id = crypto.randomUUID()
  return `${prefix}/${year}/${month}/${id}.${extensionForMime(mimeType)}`
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/**
 * Blob keys reach this module from request paths, so they are validated rather
 * than trusted. Rejecting `..` and absolute paths here means the disk adapter
 * cannot be walked out of its root.
 */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe blob key: ${key}`)
  }
}
