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
      // PreparedImage already carries the file and its dimensions, which is
      // everything the upload needs: the bytes go to storage and the numbers
      // go to the app.
      const { batchId } = await uploadBatch(lotId, photos, (done, total) => {
        setPhase({
          name: 'uploading',
          note: done === 0 ? `Uploading ${total} photos…` : `Uploaded ${done} of ${total}`,
        })
      })
      router.push(`/batches/${batchId}`)
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof ApiError ? error.message : 'Upload failed. Try again.',
      })
    }
  }

  const ready = photos.length > 0

  return (
    /*
      The whole content area is the drop target, and it stays one after the
      first pass lands: dropping a second folder on top of the first is the
      gesture, not a mode you have to re-enter.
    */
    <div
      className="capture"
      data-over={dragOver}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="stack stack--loose">
        {phase.name === 'failed' ? (
          <p className="notice notice--danger" role="alert">
            <span className="notice__glyph" aria-hidden="true">
              ■
            </span>
            <span>
              <strong>{phase.message}</strong> Your photos are still here, nothing was lost.
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setPhase(ready ? { name: 'ready' } : { name: 'idle' })}
            >
              Retry
            </button>
          </p>
        ) : null}

        {busy && 'note' in phase ? (
          <div className="progress" role="status">
            <div className="progress__head">
              <span>{phase.note}</span>
              <span className="progress__state">
                {phase.name === 'reading' ? 'reading' : `of ${photos.length}`}
              </span>
            </div>
            <div className="progress__track">
              <div className="progress__fill" />
            </div>
            <span className="meta">Keeps going if you lock the phone.</span>
          </div>
        ) : null}

        {!ready ? (
          <>
            {/* Desktop: dropping a folder is the primary gesture. */}
            <div
              className="dropzone"
              data-over={dragOver}
              onClick={() => photoInput.current?.click()}
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
              <span className="dropzone__title">Drop a folder of photos here</span>
              <span className="lede">
                No framing rules, nothing to name. Shoot everything, badly is fine. Clearspace
                sorts it out.
              </span>
              <div className="row dropzone__actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={(e) => {
                    e.stopPropagation()
                    photoInput.current?.click()
                  }}
                  disabled={busy}
                  data-state={phase.name === 'reading' ? 'loading' : undefined}
                >
                  Select photos
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    videoInput.current?.click()
                  }}
                  disabled={busy}
                >
                  Upload a video walkthrough
                </button>
              </div>
              <span className="label dropzone__limit">
                Up to {MAX_PHOTOS} photos per batch · a 90MB walkthrough uploads as ~8 frames
              </span>
            </div>

            {/* Phone: two targets big enough for a gloved thumb in bad light. */}
            <div className="bigtargets">
              <p className="lede">
                Walk the space and photograph everything you might sell. No framing rules, badly
                is fine.
              </p>
              <button
                type="button"
                className="bigtarget bigtarget--primary"
                onClick={() => photoInput.current?.click()}
                disabled={busy}
              >
                <CameraMark />
                <span className="bigtarget__title">Photograph the space</span>
                <span className="bigtarget__note">Opens the rear camera · multi-shot</span>
              </button>
              <button
                type="button"
                className="bigtarget"
                onClick={() => videoInput.current?.click()}
                disabled={busy}
              >
                <span className="bigtarget__title">Record a video walkthrough</span>
                <span className="bigtarget__note">A 90MB video uploads as ~8 sharp frames</span>
              </button>
              <span className="label bigtargets__limit">Up to {MAX_PHOTOS} photos per batch</span>
            </div>
          </>
        ) : (
          <section className="stack">
            <div className="capturehead">
              <h1 className="capturehead__count">
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'} ready
              </h1>
              <span className="label">
                {photos.length} / {MAX_PHOTOS}
              </span>
              <button type="button" className="btn btn--sm btn--quiet" onClick={clear}>
                Start over
              </button>
            </div>

            {/* Advisory, never a gate. A soft photo still finds something. */}
            {blurry > 0 ? (
              <p className="notice notice--warn">
                <span className="notice__glyph" aria-hidden="true">
                  ▲
                </span>
                <span>
                  {blurry} look blurry. They upload anyway, and sharper shots can be added later.
                </span>
              </p>
            ) : null}

            <div className="thumbgrid">
              {photos.map((photo) => (
                <figure className="thumbtile" key={photo.previewUrl}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.previewUrl} alt="" />
                  {adviceFor(photo.quality) ? (
                    <figcaption className="thumbtile__badge">
                      <span aria-hidden="true">▲</span> blurry
                    </figcaption>
                  ) : null}
                </figure>
              ))}
              <button
                type="button"
                className="thumbtile thumbtile--add"
                onClick={() => photoInput.current?.click()}
                disabled={busy}
              >
                + Add more
              </button>
            </div>
          </section>
        )}

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

      {/*
        The action bar exists only once there is something to upload. In the
        idle state the drop zone and the two big targets are already the one
        action, and a bar repeating them would be a second primary.
      */}
      {ready ? (
        <aside className="actionbar">
          <span className="actionbar__note">
            {photos.length} photos · drop more anywhere on this page
          </span>
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={upload}
            disabled={busy}
            data-state={phase.name === 'uploading' ? 'loading' : undefined}
          >
            {phase.name === 'uploading' ? 'Sending…' : `Upload ${photos.length} photos`}
          </button>
        </aside>
      ) : null}
    </div>
  )
}

/** Two plain shapes. A drawn camera, not a stock icon. */
function CameraMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <rect
        x="4"
        y="9"
        width="26"
        height="19"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="17" cy="18.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}
