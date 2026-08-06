'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { captureModes } from '@/domain/capture-guidance'
import { adviceFor } from '@/domain/image-quality'
import type { ScanKind } from '@/db/schema'
import { ApiError, createVideoScan, uploadFrames, uploadScans } from '@/lib/client/api'
import { prepareImage, type PreparedImage } from '@/lib/client/image'
import { extractKeyframes, type Keyframe } from '@/lib/client/video'

type Phase =
  | { name: 'idle' }
  | { name: 'reading'; note: string }
  | { name: 'ready' }
  | { name: 'uploading'; note: string }
  | { name: 'failed'; message: string }

/**
 * The capture screen.
 *
 * Everything expensive happens here rather than on the server: images are
 * decoded, downscaled, and scored for sharpness before upload, and video is
 * reduced to a handful of keyframes on-device. In a storage unit on one bar of
 * signal that is the difference between a scan that completes and one that
 * times out halfway.
 */
export function Capture({ lotId }: { lotId: string }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [kind, setKind] = useState<ScanKind>('scene')
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [images, setImages] = useState<PreparedImage[]>([])
  const [frames, setFrames] = useState<Keyframe[]>([])

  const mode = captureModes.find((m) => m.kind === kind)!
  const busy = phase.name === 'reading' || phase.name === 'uploading'
  const hasCapture = images.length > 0 || frames.length > 0

  function reset(next: ScanKind) {
    for (const image of images) URL.revokeObjectURL(image.previewUrl)
    for (const frame of frames) URL.revokeObjectURL(frame.previewUrl)
    setImages([])
    setFrames([])
    setKind(next)
    setPhase({ name: 'idle' })
  }

  async function onFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    // Reset so re-picking the same file still fires a change event.
    event.target.value = ''
    if (files.length === 0) return

    try {
      if (kind === 'video') {
        const file = files[0]!
        setPhase({ name: 'reading', note: 'Reading the walkthrough…' })
        const extracted = await extractKeyframes(file, {
          onProgress: (done, total) =>
            setPhase({ name: 'reading', note: `Checking frame ${done} of ${total}…` }),
        })
        if (extracted.length === 0) {
          setPhase({
            name: 'failed',
            message: 'Every frame was too blurry to use. Try walking more slowly.',
          })
          return
        }
        setFrames(extracted)
      } else {
        setPhase({ name: 'reading', note: 'Preparing photos…' })
        const prepared: PreparedImage[] = []
        for (const file of files) {
          prepared.push(await prepareImage(file))
        }
        setImages(prepared)
      }
      setPhase({ name: 'ready' })
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof Error ? error.message : 'Could not read that file.',
      })
    }
  }

  async function upload() {
    try {
      if (kind === 'video') {
        setPhase({ name: 'uploading', note: `Uploading ${frames.length} frames…` })
        const { scans } = await createVideoScan(lotId)
        const scan = scans[0]
        if (!scan) throw new Error('Could not start that scan.')
        await uploadFrames(scan.id, frames)
        router.push(`/scans/${scan.id}`)
        return
      }

      setPhase({
        name: 'uploading',
        note: images.length === 1 ? 'Uploading photo…' : `Uploading ${images.length} photos…`,
      })
      const { scans } = await uploadScans(
        lotId,
        kind === 'scene' ? 'scene' : 'photo',
        images.map((image) => image.file),
      )
      const first = scans[0]
      if (!first) throw new Error('Nothing was uploaded.')
      router.push(`/scans/${first.id}`)
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
          <h1>What are you looking at?</h1>
          <p className="lede">
            More light and less distance beat more photos. Sorta reads what the camera can
            actually see.
          </p>
        </div>

        <div className="modes" role="group" aria-label="Capture method">
          {captureModes.map((option) => (
            <button
              type="button"
              key={option.kind}
              className="mode"
              aria-pressed={option.kind === kind}
              onClick={() => reset(option.kind)}
              disabled={busy}
            >
              <span className="mode__title">{option.title}</span>
              <span className="meta">{option.blurb}</span>
            </button>
          ))}
        </div>

        <section className="panel">
          <div className="panel__head">
            <span className="label">Before you shoot</span>
          </div>
          <div className="panel__body">
            <ul className="steps">
              {mode.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        </section>

        {phase.name === 'failed' ? (
          <p className="notice notice--danger">
            <span aria-hidden="true">⚠</span>
            <span>{phase.message}</span>
          </p>
        ) : null}

        {images.length > 0 ? (
          <section className="stack">
            <span className="label">
              {images.length} {images.length === 1 ? 'photo' : 'photos'} ready
            </span>
            <div className="photos">
              {images.map((image) => {
                const advice = adviceFor(image.quality)
                return (
                  <figure className="photo" key={image.previewUrl}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.previewUrl} alt="" />
                    {advice ? <figcaption className="photo__view">Reshoot</figcaption> : null}
                  </figure>
                )
              })}
            </div>
            {images.some((image) => adviceFor(image.quality)) ? (
              <p className="notice">
                <span aria-hidden="true">◆</span>
                <span>
                  {adviceFor(images.find((image) => adviceFor(image.quality))!.quality)} You can
                  upload anyway — detection will just find less.
                </span>
              </p>
            ) : null}
          </section>
        ) : null}

        {frames.length > 0 ? (
          <section className="stack">
            <span className="label">
              {frames.length} sharp frames pulled from the walkthrough
            </span>
            <div className="photos">
              {frames.map((frame) => (
                <figure className="photo" key={frame.previewUrl}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={frame.previewUrl} alt="" />
                  <figcaption className="photo__view">
                    {(frame.tMs / 1000).toFixed(1)}s
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept={mode.accept}
          multiple={mode.multiple}
          capture="environment"
          onChange={onFiles}
        />
      </div>

      <aside className="actionbar">
        <span className="actionbar__note">
          {phase.name === 'reading' || phase.name === 'uploading'
            ? phase.note
            : hasCapture
              ? 'Looks right? Send it for detection.'
              : mode.blurb}
        </span>
        {hasCapture ? (
          <>
            <button
              type="button"
              className="btn"
              onClick={() => reset(kind)}
              disabled={busy}
            >
              Retake
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={upload}
              disabled={busy}
              data-state={phase.name === 'uploading' ? 'loading' : undefined}
            >
              {phase.name === 'uploading' ? 'Sending…' : 'Detect'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            data-state={phase.name === 'reading' ? 'loading' : undefined}
          >
            {phase.name === 'reading' ? 'Reading…' : kind === 'video' ? 'Record' : 'Take photo'}
          </button>
        )}
      </aside>
    </>
  )
}
