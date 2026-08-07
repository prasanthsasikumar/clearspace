import {
  assertSafeKey,
  type BlobData,
  type BlobStore,
  type StoredBlob,
} from './blob-store'

export interface SupabaseBlobStoreOptions {
  /** Project URL, e.g. https://abcdefg.supabase.co */
  url: string
  /** Service-role key. Server-side only: never reaches the browser. */
  serviceKey: string
  bucket: string
}

/**
 * Supabase Storage behind the same `BlobStore` interface as the local disk.
 *
 * Written against the Storage REST API with plain `fetch` rather than the
 * Supabase SDK: this needs four operations, the SDK is a large dependency to
 * carry into a serverless bundle for them, and the REST surface is stable.
 *
 * Blobs are still read back through the app's own `/api/blobs/*` route rather
 * than exposing Supabase URLs directly. That keeps one code path for local disk
 * and hosted storage, keeps the bucket private, and means nothing in the UI has
 * to know which driver is behind it.
 */
export class SupabaseBlobStore implements BlobStore {
  private readonly base: string

  constructor(private readonly options: SupabaseBlobStoreOptions) {
    this.base = `${options.url.replace(/\/$/, '')}/storage/v1/object`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.serviceKey}`,
      ...extra,
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredBlob> {
    assertSafeKey(key)
    const response = await fetch(`${this.base}/${this.options.bucket}/${key}`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': contentType,
        // Re-running a job must not fail on an object that already exists.
        'x-upsert': 'true',
      }),
      body: new Uint8Array(data),
    })

    if (!response.ok) {
      throw new Error(
        `Supabase upload failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      )
    }

    return { key, contentType, byteSize: data.byteLength }
  }

  async get(key: string): Promise<BlobData | null> {
    assertSafeKey(key)
    const response = await fetch(`${this.base}/${this.options.bucket}/${key}`, {
      headers: this.headers(),
    })

    if (response.status === 404 || response.status === 400) return null
    if (!response.ok) {
      throw new Error(`Supabase download failed (${response.status})`)
    }

    return {
      data: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    const response = await fetch(`${this.base}/${this.options.bucket}/${key}`, {
      method: 'DELETE',
      headers: this.headers(),
    })
    // Deleting something already gone is not a failure worth propagating.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase delete failed (${response.status})`)
    }
  }

  url(key: string): string {
    assertSafeKey(key)
    return `/api/blobs/${key}`
  }

  /**
   * A signed URL the browser can PUT one object to.
   *
   * Signed rather than handing the browser a key: the token is scoped to this
   * one path, expires, and cannot be turned into a read of anyone else's
   * bucket. The service key never leaves the server.
   */
  async createUploadTarget(
    key: string,
    contentType: string,
  ): Promise<{ url: string; headers: Record<string, string> } | null> {
    assertSafeKey(key)
    const base = this.options.url.replace(/\/$/, '')
    const response = await fetch(
      `${base}/storage/v1/object/upload/sign/${this.options.bucket}/${key}`,
      { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }) },
    )

    if (!response.ok) return null
    const body = (await response.json()) as { url?: string }
    if (!body.url) return null

    return {
      url: `${base}/storage/v1${body.url}`,
      headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    }
  }
}
