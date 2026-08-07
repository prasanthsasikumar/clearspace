'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, uploadBatch } from '@/lib/client/api'
import { prepareImage, type PreparedImage } from '@/lib/client/image'

const MAX_PHOTOS = 60

/**
 * Add photos, without a page in the way.
 *
 * Tapping this used to open a screen whose whole job was to offer a file
 * picker, which is a screen asking permission to do the thing that was just
 * asked for. It opens the picker.
 *
 * Everything after that is the same path a batch has always taken: the browser
 * downscales and scores each photo, sends them to storage, and hands off to
 * the progress screen. What is gone is the step in the middle.
 */
export function AddPhotosButton({
  lotId,
  label = 'Add photos',
  className = 'btn btn--sm',
}: {
  lotId: string
  label?: string
  className?: string
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = note !== null

  async function onPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return

    if (files.length > MAX_PHOTOS) {
      setError(`That is more than ${MAX_PHOTOS} photos. Do this space in a couple of passes.`)
      return
    }

    setError(null)
    try {
      const prepared: PreparedImage[] = []
      for (const [index, file] of files.entries()) {
        setNote(`Reading ${index + 1} of ${files.length}`)
        prepared.push(await prepareImage(file))
      }

      const { batchId } = await uploadBatch(lotId, prepared, (done, total) => {
        setNote(done === 0 ? `Sending ${total}` : `Sent ${done} of ${total}`)
      })
      router.push(`/batches/${batchId}`)
    } catch (cause) {
      setNote(null)
      setError(cause instanceof ApiError ? cause.message : 'Those photos did not go up.')
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => input.current?.click()}
        disabled={busy}
        data-state={busy ? 'loading' : undefined}
      >
        {note ?? label}
      </button>

      {error ? (
        <p className="toast" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
          <button type="button" className="btn btn--sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      ) : null}

      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void onPicked(e)}
      />
    </>
  )
}
