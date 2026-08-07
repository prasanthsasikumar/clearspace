'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { adviceFor } from '@/domain/image-quality'
import { ApiError, uploadBatch } from '@/lib/client/api'
import { prepareImage, type PreparedImage } from '@/lib/client/image'
import { extractKeyframes } from '@/lib/client/video'

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; note: string }
  | { name: 'ready' }
  | { name: 'uploading'; note: string }
  | { name: 'failed'; message: string }

const MAX_PHOTOS = 60

/**
 * Bulk capture: the front door of the whole product.
 *
 * The user's job is to walk around taking photos badly and then hand them over.
 * There is no per-item ceremony here, no framing rules to follow, and nothing
 * to name: pick everything, tap once, walk away. Anything that asks the user to
 * think about an individual object belongs after grouping, not before it.
 *
 * A video walkthrough lands in the same place: frames are pulled out on the
 * phone and uploaded as ordinary photos, so grouping treats a walkthrough and a
 * pile of stills identically.
 */
export function BulkCapture({ lotId }: { lotId: string }) {
  const router = useRouter()
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [photos, setPhotos] = useState<PreparedImage[]>([])
  const [dragOver, setDragOver] = useState(false)

  const busy = phase.name === 'reading' || phase.name === 'uploading'
  const blurry = photos.filter((p) => adviceFor(p.quality)).length

  function clear() {
    for (const photo of photos) URL.revokeObjectURL(photo.previewUrl)
    setPhotos([])
    setPhase({ name: 'idle' })
  }

  async function onPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    await ingest(files)
  }

  /** One ingest path, so dropping and picking can never behave differently. */
  async function ingest(files: readonly File[]) {
    if (files.length === 0) return

    if (photos.length + files.length > MAX_PHOTOS) {
      setPhase({
        name: 'failed',
        message: `That is more than ${MAX_PHOTOS} photos. Do this space in a couple of passes.`,
      })
      return
    }

    try {
      const prepared: PreparedImage[] = []
      for (const [index, file] of files.entries()) {
        setPhase({ name: 'reading', note: `Preparing ${index + 1} of ${files.length}…` })
        prepared.push(await prepareImage(file))
      }
      // Appending rather than replacing lets a user add the back wall to the
      // front wall without losing the first pass.
      setPhotos((prev) => [...prev, ...prepared])
      setPhase({ name: 'ready' })
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof Error ? error.message : 'Could not read those photos.',
      })
    }
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const dropped = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (dropped.length === 0) {
      setPhase({ name: 'failed', message: 'Those were not image files.' })
      return
    }
    await ingest(dropped)
  }

  async function onVideo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      setPhase({ name: 'reading', note: 'Reading the walkthrough…' })
      const frames = await extractKeyframes(file, {
        maxFrames: 12,
        onProgress: (done, total) =>
          setPhase({ name: 'reading', note: `Checking frame ${done} of ${total}…` }),
      })
      if (frames.length === 0) {
        setPhase({
          name: 'failed',
          message: 'Every frame was too blurry to use. Try walking more slowly.',
        })
        return
      }

      // Frames become ordinary photos, so a walkthrough and a pile of stills
      // travel the exact same path from here on.
      const prepared: PreparedImage[] = []
      for (const [index, frame] of frames.entries()) {
        prepared.push(
          await prepareImage(
            new File([frame.blob], `frame-${index}.jpg`, { type: 'image/jpeg' }),
          ),
        )
      }
      setPhotos((prev) => [...prev, ...prepared])
      setPhase({ name: 'ready' })
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof Error ? error.message : 'Could not read that video.',
      })
    }
  }

  async function upload() {
    setPhase({ name: 'uploading', note: `Uploading ${photos.length} photos…` })
    try {
      const { batchId } = await uploadBatch(
        lotId,
        photos.map((photo) => photo.file),
      )
      router.push(`/batches/${batchId}`)
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof ApiError ? error.message : 'Upload failed. Try again.',
      })
    }
  }

  return (
    <>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1>Photograph the whole space.</h1>
          <p className="lede">
            Walk around and shoot everything. Overlap, repeat yourself, get it wrong. Clearspace
            works out which photos show the same thing.
          </p>
        </div>

        {photos.length === 0 ? (
          <div
            className="dropzone"
            data-over={dragOver}
            onClick={() => photoInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void onDrop(e)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                photoInput.current?.click()
              }
            }}
          >
            <span className="dropzone__mark" aria-hidden="true" />
            <span className="dropzone__title">Drop your photos here</span>
            <span className="meta">or tap to pick them from your camera roll</span>
          </div>
        ) : null}

        {photos.length === 0 ? (
          <section className="panel">
            <div className="panel__head">
              <span className="label">Worth knowing</span>
            </div>
            <div className="panel__body">
              <ul className="steps">
                <li>Open the door and let in as much light as you can.</li>
                <li>Photograph anything you might sell, several times, from wherever you are standing.</li>
                <li>Get closer to small things. A shelf of tools needs its own shot.</li>
                <li>Twenty photos of a storage unit is plenty. Sixty is the limit.</li>
              </ul>
            </div>
          </section>
        ) : null}

        {phase.name === 'failed' ? (
          <p className="notice notice--danger" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{phase.message}</span>
          </p>
        ) : null}

        {photos.length > 0 ? (
          <section className="stack">
            <div className="row row--between">
              <span className="label">
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
              </span>
              <button type="button" className="btn btn--sm btn--quiet" onClick={clear}>
                Start over
              </button>
            </div>
            <div className="photos">
              {photos.map((photo) => (
                <figure className="photo" key={photo.previewUrl}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt="" />
                  {adviceFor(photo.quality) ? (
                    <figcaption className="photo__view">Soft</figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
            {blurry > 0 ? (
              <p className="notice">
                <span aria-hidden="true">◆</span>
                <span>
                  {blurry} {blurry === 1 ? 'photo looks' : 'photos look'} soft or dark. They
                  still upload. Clearspace will just find less in them.
                </span>
              </p>
            ) : null}
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => photoInput.current?.click()}
                disabled={busy}
              >
                Add more
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => videoInput.current?.click()}
                disabled={busy}
              >
                Add a walkthrough
              </button>
            </div>
          </section>
        ) : null}

        <input
          ref={photoInput}
          className="visually-hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={onPhotos}
        />
        <input
          ref={videoInput}
          className="visually-hidden"
          type="file"
          accept="video/*"
          capture="environment"
          onChange={onVideo}
        />
      </div>

      <aside className="actionbar">
        <span className="actionbar__note">
          {busy && 'note' in phase
            ? phase.note
            : photos.length > 0
              ? 'Clearspace takes it from here.'
              : 'Pick everything at once.'}
        </span>
        {photos.length === 0 ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => videoInput.current?.click()}
              disabled={busy}
            >
              Video
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => photoInput.current?.click()}
              disabled={busy}
              data-state={phase.name === 'reading' ? 'loading' : undefined}
            >
              {phase.name === 'reading' ? 'Reading…' : 'Choose photos'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={upload}
            disabled={busy}
            data-state={phase.name === 'uploading' ? 'loading' : undefined}
          >
            {phase.name === 'uploading' ? 'Sending…' : `Sort ${photos.length}`}
          </button>
        )}
      </aside>
    </>
  )
}
