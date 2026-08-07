import type { CoverageResult } from '@/domain/coverage'
import type { BoundingBox } from '@/domain/geometry'
import type { PhotoQuality } from '@/domain/types'
import type {
  Detection,
  Item,
  ItemPhoto,
  Lot,
  PhotoView,
  Scan,
  ScanFrame,
} from '@/db/schema'
import type { LotSummary } from '@/services/lots'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import type { BatchProgress } from '@/services/batches'
import type { EnrichmentRunProgress } from '@/services/enrichment'

/**
 * Carries the server's own error message to the UI.
 *
 * The API writes its messages for the person holding the phone, so surfacing
 * them verbatim is better than a generic "something went wrong": "That file
 * is larger than 25 MB" tells the user what to do next.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError('No connection. Check your signal and try again.', 0, 'offline')
  }

  if (!response.ok) {
    let message = 'Something went wrong.'
    let code = 'unknown'
    try {
      const body = (await response.json()) as {
        error?: { message?: string; code?: string }
      }
      message = body.error?.message ?? message
      code = body.error?.code ?? code
    } catch {
      // A non-JSON error body is still an error; the default message stands.
    }
    throw new ApiError(message, response.status, code)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/* --- Lots ------------------------------------------------------------------ */

export const listLots = () => request<{ lots: LotSummary[] }>('/api/lots')

export const createLot = (input: {
  name: string
  kind: string
  locationText?: string | null
}) => request<{ lot: Lot }>('/api/lots', json('POST', input))

export const deleteLot = (lotId: string) =>
  request<{ deleted: boolean }>(`/api/lots/${lotId}`, { method: 'DELETE' })

/* --- Scans ----------------------------------------------------------------- */

export async function uploadScans(
  lotId: string,
  kind: 'scene' | 'photo',
  files: readonly File[],
): Promise<{ scans: Scan[]; jobIds: string[] }> {
  const form = new FormData()
  form.set('kind', kind)
  for (const file of files) form.append('files', file)
  return request(`/api/lots/${lotId}/scans`, { method: 'POST', body: form })
}

export async function createVideoScan(lotId: string): Promise<{ scans: Scan[] }> {
  const form = new FormData()
  form.set('kind', 'video')
  return request(`/api/lots/${lotId}/scans`, { method: 'POST', body: form })
}

export async function uploadFrames(
  scanId: string,
  frames: readonly { blob: Blob; tMs: number; sharpness: number }[],
): Promise<{ frames: ScanFrame[]; jobIds: string[] }> {
  const form = new FormData()
  for (const [index, frame] of frames.entries()) {
    form.append('files', new File([frame.blob], `frame-${index}.jpg`, { type: 'image/jpeg' }))
    form.append('tMs', String(frame.tMs))
    form.append('sharpness', String(frame.sharpness))
  }
  return request(`/api/scans/${scanId}/frames`, { method: 'POST', body: form })
}

/* --- Batches --------------------------------------------------------------- */

export interface UploadablePhoto {
  file: File
  width: number
  height: number
}

/** Two retries with a growing pause: enough for a lift or a passing van. */
const UPLOAD_ATTEMPTS = 3

async function putWithRetry(
  url: string,
  headers: Record<string, string>,
  file: File,
): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'PUT', headers, body: file })
      if (response.ok) return
      // A refused signature will be refused again; only transport is worth
      // retrying, and 4xx here means the target itself is wrong.
      if (response.status < 500) throw new Error(`Upload rejected (${response.status})`)
      lastError = new Error(`Upload failed (${response.status})`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt))
  }
  throw lastError instanceof Error ? lastError : new Error('Upload failed')
}

/**
 * Sends a batch, one photo at a time, straight to storage where it can.
 *
 * The whole pile used to go up in a single request, so a drop at ninety
 * percent lost all of it and the walk around the unit had to be repeated.
 * Photos now go to storage individually and a failure costs the one in flight.
 * Where the driver cannot issue upload targets, local disk in development, it
 * falls back to posting the files as before.
 *
 * `onProgress` reports photos landed, because a minute of silence on one bar
 * of signal is indistinguishable from a hang.
 */
export async function uploadBatch(
  lotId: string,
  photos: readonly UploadablePhoto[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ batchId: string; photoCount: number }> {
  const targets = await request<{
    direct: boolean
    targets: { key: string; url: string; headers: Record<string, string> }[]
  }>(`/api/lots/${lotId}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: photos.map((p) => ({ mimeType: p.file.type })) }),
  }).catch(() => ({ direct: false, targets: [] }))

  if (!targets.direct || targets.targets.length !== photos.length) {
    const form = new FormData()
    for (const photo of photos) form.append('files', photo.file)
    onProgress?.(0, photos.length)
    return request(`/api/lots/${lotId}/batches`, { method: 'POST', body: form })
  }

  const batchId = crypto.randomUUID()
  const landed: {
    blobKey: string
    mimeType: string
    width: number
    height: number
    byteSize: number
  }[] = []

  for (const [index, photo] of photos.entries()) {
    const target = targets.targets[index]!
    await putWithRetry(target.url, target.headers, photo.file)
    landed.push({
      blobKey: target.key,
      mimeType: photo.file.type || 'image/jpeg',
      width: photo.width,
      height: photo.height,
      byteSize: photo.file.size,
    })
    onProgress?.(landed.length, photos.length)
  }

  // One call to record them and close the batch, so analysis starts on all of
  // it at once rather than on whichever photo arrived first.
  const form = new FormData()
  form.append('batchId', batchId)
  form.append('uploaded', JSON.stringify(landed))
  form.append('final', 'true')
  return request(`/api/lots/${lotId}/batches`, { method: 'POST', body: form })
}

export interface BatchPhoto {
  id: string
  blobKey: string
  width: number | null
  height: number | null
  boxes: { x: number; y: number; w: number; h: number }[]
}

export const getBatchPhotos = (batchId: string) =>
  request<{ photos: BatchPhoto[] }>(`/api/batches/${batchId}/photos`)

export const getBatch = (batchId: string) =>
  request<BatchProgress>(`/api/batches/${batchId}`)

export const getScan = (scanId: string) =>
  request<{ scan: Scan; frames: ScanFrame[]; detections: Detection[] }>(
    `/api/scans/${scanId}`,
  )

/* --- Detections ------------------------------------------------------------ */

export const promoteDetection = (detectionId: string) =>
  request<{ item: Item }>(`/api/detections/${detectionId}/promote`, { method: 'POST' })

export const dismissDetection = (detectionId: string) =>
  request<{ dismissed: boolean }>(`/api/detections/${detectionId}/dismiss`, {
    method: 'POST',
  })

export const renameDetection = (detectionId: string, label: string) =>
  request<{ updated: boolean }>(`/api/detections/${detectionId}`, json('PATCH', { label }))

export const addDetection = (
  scanId: string,
  input: { label: string; bbox: BoundingBox; frameId?: string },
) => request<{ detectionId: string }>(`/api/scans/${scanId}/detections`, json('POST', input))

/* --- Items ----------------------------------------------------------------- */

export const listItems = (lotId: string) =>
  request<{ items: ItemWithPrimaryPhoto[] }>(`/api/lots/${lotId}/items`)

export const createItem = (lotId: string, input: { title: string; category?: string | null }) =>
  request<{ item: Item }>(`/api/lots/${lotId}/items`, json('POST', input))

export const getItem = (itemId: string) =>
  request<{ item: Item; photos: ItemPhoto[]; coverage: CoverageResult }>(
    `/api/items/${itemId}`,
  )

export const updateItem = (itemId: string, input: Record<string, unknown>) =>
  request<{ item: Item; photos: ItemPhoto[]; coverage: CoverageResult }>(
    `/api/items/${itemId}`,
    json('PATCH', input),
  )

export const deleteItem = (itemId: string) =>
  request<{ deleted: boolean }>(`/api/items/${itemId}`, { method: 'DELETE' })

export async function uploadItemPhoto(
  itemId: string,
  input: { file: File; view: PhotoView; quality: PhotoQuality },
): Promise<{ photo: ItemPhoto; coverage: CoverageResult | null }> {
  const form = new FormData()
  form.set('file', input.file)
  form.set('view', input.view)
  form.set('quality', JSON.stringify(input.quality))
  return request(`/api/items/${itemId}/photos`, { method: 'POST', body: form })
}

export const deletePhoto = (photoId: string) =>
  request<{ deleted: boolean }>(`/api/photos/${photoId}`, { method: 'DELETE' })

/* --- Enrichment ------------------------------------------------------------ */

export const requestEnrichment = (lotId: string, itemIds: readonly string[]) =>
  request<EnrichmentRunProgress>(`/api/lots/${lotId}/enrich`, json('POST', { itemIds }))

export const getEnrichmentProgress = (lotId: string) =>
  request<EnrichmentRunProgress>(`/api/lots/${lotId}/enrich`)

/* --- Export ---------------------------------------------------------------- */

export interface ExportNote {
  itemId: string
  field: string
  message: string
}

export interface ExportPreview {
  /** Rows the Facebook catalogue feed would carry. */
  rowCount: number
  skipped: ExportNote[]
  warnings: ExportNote[]
  unconfirmedPrices: number
  /*
   * The two exports leave different things out: the catalogue feed needs a
   * photograph, the Marketplace sheet needs a condition. They are reported
   * apart so the dialog never promises one export's readiness for the other.
   */
  marketplaceRowCount: number
  marketplaceSkipped: ExportNote[]
  marketplaceWarnings: ExportNote[]
}

export const getExportPreview = (lotId: string) =>
  request<ExportPreview>(`/api/lots/${lotId}/export/preview`)

export const exportUrl = (lotId: string) => `/api/lots/${lotId}/export`

/** The Marketplace bulk-upload workbook: what a private seller actually wants. */
export const marketplaceExportUrl = (lotId: string) =>
  `/api/lots/${lotId}/export/marketplace`

/* --- Queue ----------------------------------------------------------------- */

/**
 * Nudges the queue while the user is watching.
 *
 * On a serverless host nothing drains the queue between requests, and a
 * scheduler's granularity is a minute at best, a day on Vercel's Hobby plan.
 * Since the progress screens already poll, they may as well do the work: this
 * makes processing start the instant somebody is waiting for it.
 *
 * Failures are swallowed on purpose. This is an optimisation over the
 * scheduler, not a dependency, and a red error about a background nudge would
 * be noise the user can do nothing about.
 */
export async function nudgeQueue(): Promise<void> {
  try {
    await fetch('/api/jobs/tick', { method: 'POST' })
  } catch {
    /* the scheduler remains the backstop */
  }
}

/* --- Blobs ----------------------------------------------------------------- */

export const blobUrl = (key: string) => `/api/blobs/${key}`
