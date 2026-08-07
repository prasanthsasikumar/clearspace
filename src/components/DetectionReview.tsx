'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Detection, Scan, ScanFrame } from '@/db/schema'
import { boxFromDrag, isValidBox, type BoundingBox } from '@/domain/geometry'
import { detectionFeedback } from '@/domain/capture-guidance'
import {
  ApiError,
  addDetection,
  blobUrl,
  dismissDetection,
  getScan,
  promoteDetection,
} from '@/lib/client/api'

interface DetectionReviewProps {
  lotId: string
  scan: Scan
  frames: ScanFrame[]
  detections: Detection[]
}

const POLL_MS = 1500

/**
 * The detection review screen: the one that has to be right.
 *
 * Three things make it usable in the field. Tapping a box promotes it and the
 * box turns green immediately, before the request finishes, because waiting
 * 400 ms per item across sixty items is four minutes of nothing. A list sits
 * under the image mirroring every box, because a 40 px box on a crowded shelf
 * is not a reliable tap target. And there is a draw mode, because every
 * detector misses things and a review screen that can only subtract is a
 * review screen that dead-ends.
 */
export function DetectionReview({
  lotId,
  scan: initialScan,
  frames,
  detections: initialDetections,
}: DetectionReviewProps) {
  const router = useRouter()
  const stageRef = useRef<HTMLDivElement>(null)

  const [scan, setScan] = useState(initialScan)
  const [detections, setDetections] = useState(initialDetections)
  const [frameId, setFrameId] = useState<string | null>(frames[0]?.id ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<Set<string>>(new Set())
  const [drawing, setDrawing] = useState(false)
  // Which box and row are lit together. A 40px box on a crowded shelf is not a
  // reliable target, so the list is the real one; pairing is what tells you
  // which thing in the photo the row you are pointing at actually is.
  const [pairedId, setPairedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<BoundingBox | null>(null)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const working = scan.status === 'uploaded' || scan.status === 'processing'

  /* --- Polling ------------------------------------------------------------ */

  const refresh = useCallback(async () => {
    try {
      const next = await getScan(scan.id)
      setScan(next.scan)
      setDetections(next.detections)
    } catch {
      // A dropped poll is not worth surfacing; the next tick will retry.
    }
  }, [scan.id])

  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [working, refresh])

  /* --- Derived ------------------------------------------------------------ */

  const visible = useMemo(
    () =>
      detections
        .filter((d) => (frameId ? d.frameId === frameId : d.frameId === null))
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [detections, frameId],
  )

  const activeFrame = frames.find((f) => f.id === frameId) ?? null
  const imageKey = activeFrame?.blobKey ?? scan.blobKey
  const promotedCount = visible.filter((d) => d.promotedItemId !== null).length
  const feedback = working ? null : detectionFeedback(visible.length)

  /* --- Actions ------------------------------------------------------------ */

  async function promote(detection: Detection) {
    if (detection.promotedItemId) {
      router.push(`/items/${detection.promotedItemId}`)
      return
    }

    setPromoting((prev) => new Set(prev).add(detection.id))
    setError(null)

    // Optimistic: the box turns green now, not in 400 ms.
    setDetections((prev) =>
      prev.map((d) => (d.id === detection.id ? { ...d, promotedItemId: 'pending' } : d)),
    )

    try {
      const { item } = await promoteDetection(detection.id)
      setDetections((prev) =>
        prev.map((d) => (d.id === detection.id ? { ...d, promotedItemId: item.id } : d)),
      )
      router.refresh()
    } catch (cause) {
      setDetections((prev) =>
        prev.map((d) => (d.id === detection.id ? { ...d, promotedItemId: null } : d)),
      )
      setError(
        cause instanceof ApiError ? cause.message : 'Could not add that item. Try again.',
      )
    } finally {
      setPromoting((prev) => {
        const next = new Set(prev)
        next.delete(detection.id)
        return next
      })
    }
  }

  async function dismiss(detection: Detection) {
    const snapshot = detections
    setDetections((prev) => prev.filter((d) => d.id !== detection.id))
    setSelectedId(null)
    try {
      await dismissDetection(detection.id)
    } catch {
      setDetections(snapshot)
      setError('Could not dismiss that box.')
    }
  }

  /* --- Draw mode ---------------------------------------------------------- */

  function pointAt(event: React.PointerEvent): { x: number; y: number } | null {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }

  function onPointerDown(event: React.PointerEvent) {
    if (!drawing) return
    const point = pointAt(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(point)
    setDraft(null)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drawing || !dragStart) return
    const point = pointAt(event)
    if (!point) return
    setDraft(boxFromDrag(dragStart, point))
  }

  async function onPointerUp() {
    if (!drawing || !dragStart) return
    const box = draft
    setDragStart(null)
    setDraft(null)

    if (!box || !isValidBox(box) || box.w < 0.02 || box.h < 0.02) return

    const label = window.prompt('What is it?')?.trim()
    if (!label) return

    try {
      await addDetection(scan.id, {
        label,
        bbox: box,
        ...(frameId ? { frameId } : {}),
      })
      await refresh()
      setDrawing(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save that box.')
    }
  }

  /* --- Render ------------------------------------------------------------- */

  return (
    <>
      <div className="split split--railEnd">
        <div className="split__main stack stack--loose">
        <div className="stack stack--tight">
          <h1>{working ? 'Looking at your photo…' : `${visible.length} things found`}</h1>
          <p className="lede">
            {working
              ? 'This takes about half a minute for a full room.'
              : 'Tap what is worth selling. Everything you skip stays out of the inventory.'}
          </p>
        </div>

        {frames.length > 1 ? (
          <div className="row" role="group" aria-label="Walkthrough frames">
            {frames.map((frame, index) => (
              <button
                type="button"
                key={frame.id}
                className={`btn btn--sm${frame.id === frameId ? ' btn--primary' : ''}`}
                onClick={() => {
                  setFrameId(frame.id)
                  setSelectedId(null)
                }}
              >
                {index + 1} · {(frame.tMs / 1000).toFixed(1)}s
              </button>
            ))}
          </div>
        ) : null}

        {/* Draw mode is a mode, so it says so, and says how to leave. */}
        {drawing ? (
          <div className="drawbar" role="status">
            <span className="label drawbar__title">Draw mode</span>
            <span className="meta">Drag a box around the thing Clearspace missed.</span>
            <button
              type="button"
              className="btn btn--sm btn--quiet"
              onClick={() => setDrawing(false)}
            >
              Esc to cancel
            </button>
          </div>
        ) : null}

        <div
          className="stage"
          ref={stageRef}
          data-draw={drawing}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
          onPointerCancel={() => {
            setDragStart(null)
            setDraft(null)
          }}
        >
          {imageKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="stage__image"
              src={blobUrl(imageKey)}
              alt="The photo being reviewed"
              fetchPriority="high"
            />
          ) : (
            <p className="stage__hint">Waiting for the image…</p>
          )}

          <div className="stage__overlay">
            {visible.map((detection, index) => {
              const promoted = detection.promotedItemId !== null
              return (
                <button
                  type="button"
                  key={detection.id}
                  className="box"
                  style={boxStyle(detection.bbox)}
                  data-selected={detection.id === selectedId}
                  data-promoted={promoted}
                  data-paired={detection.id === pairedId}
                  onMouseEnter={() => setPairedId(detection.id)}
                  onMouseLeave={() => setPairedId(null)}
                  aria-label={`${detection.label}${promoted ? ', already added' : ''}`}
                  onClick={(event) => {
                    if (drawing) return
                    event.stopPropagation()
                    setSelectedId(detection.id === selectedId ? null : detection.id)
                  }}
                  // Draw mode owns the surface; boxes step aside.
                  disabled={drawing}
                >
                  <span className="box__tag">
                    {index + 1}
                    <span className="box__label">
                      {' '}
                      {detection.label}
                      {promoted ? ' ✓' : ''}
                    </span>
                  </span>
                </button>
              )
            })}

            {draft ? <div className="box box--draft" style={boxStyle(draft)} /> : null}
          </div>
        </div>

        {working ? (
          <p className="working">
            <span className="working__dot" aria-hidden="true" />
            Analysing
          </p>
        ) : null}

        {scan.status === 'failed' ? (
          <p className="notice notice--danger">
            <span aria-hidden="true">⚠</span>
            <span>{scan.error ?? 'Detection failed on this photo.'}</span>
          </p>
        ) : null}

        {error ? (
          <p className="toast" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
            <button type="button" className="btn btn--sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        {feedback ? (
          <p className="notice">
            <span aria-hidden="true">◆</span>
            <span>{feedback}</span>
          </p>
        ) : null}

        </div>

        <aside className="split__rail" aria-label="What was found in this photo">
        {visible.length > 0 ? (
          <section className="panel panel--flush">
            <div className="panel__head">
              <span className="label">Detected</span>
              <span className="label">
                {promotedCount} of {visible.length} added
              </span>
            </div>
            {visible.map((detection) => {
              const promoted = detection.promotedItemId !== null
              const isPending = promoting.has(detection.id)
              return (
                <div
                  className="rowlink"
                  key={detection.id}
                  data-paired={detection.id === pairedId}
                  onMouseEnter={() => setPairedId(detection.id)}
                  onMouseLeave={() => setPairedId(null)}
                >
                  <span className="label" aria-hidden="true">
                    {detection.confidence === null
                      ? 'YOU'
                      : `${Math.round(detection.confidence * 100)}`}
                  </span>
                  <button
                    type="button"
                    className="linkish stack stack--tight"
                    onClick={() => setSelectedId(detection.id)}
                  >
                    <span className="rowlink__title">{detection.label}</span>
                    <span className="meta">
                      {detection.source === 'user'
                        ? 'You drew this'
                        : detection.category ?? 'Uncategorised'}
                    </span>
                  </button>
                  {promoted ? (
                    <span className="chip chip--ok">Added</span>
                  ) : (
                    <span className="row">
                      <button
                        type="button"
                        className="btn btn--sm btn--quiet"
                        onClick={() => void dismiss(detection)}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => void promote(detection)}
                        disabled={isPending}
                        data-state={isPending ? 'loading' : undefined}
                      >
                        {isPending ? 'Adding…' : 'Add'}
                      </button>
                    </span>
                  )}
                </div>
              )
            })}
          </section>
        ) : null}

        {!working && visible.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Nothing detected.</p>
            <p className="empty__lede">
              Draw a box around anything worth selling, or go back and shoot the wall closer.
            </p>
          </div>
        ) : null}

        <p className="rail__note meta">
          Hovering a row lights its box, and the other way round. Something with no box at all?
          Draw one.
        </p>
        </aside>
      </div>

      <aside className="actionbar">
        {selectedId ? (
          <SelectedActions
            detection={visible.find((d) => d.id === selectedId)!}
            pending={promoting.has(selectedId)}
            onPromote={promote}
            onDismiss={dismiss}
          />
        ) : (
          <>
            <span className="actionbar__note">
              {drawing
                ? 'Drag a box around the missed item.'
                : promotedCount > 0
                  ? `${promotedCount} added to the inventory.`
                  : 'Tap a box, or add one Clearspace missed.'}
            </span>
            <button
              type="button"
              className={drawing ? 'btn btn--primary' : 'btn'}
              onClick={() => setDrawing((d) => !d)}
              aria-pressed={drawing}
            >
              {drawing ? 'Done drawing' : 'Add box'}
            </button>
            <Link className="btn btn--primary" href={`/lots/${lotId}`}>
              Inventory
            </Link>
          </>
        )}
      </aside>
    </>
  )
}

function SelectedActions({
  detection,
  pending,
  onPromote,
  onDismiss,
}: {
  detection: Detection
  pending: boolean
  onPromote: (d: Detection) => Promise<void>
  onDismiss: (d: Detection) => Promise<void>
}) {
  const promoted = detection.promotedItemId !== null
  return (
    <>
      <span className="actionbar__note">{detection.label}</span>
      {promoted ? (
        <Link className="btn btn--primary" href={`/items/${detection.promotedItemId}`}>
          Open item
        </Link>
      ) : (
        <>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => void onDismiss(detection)}
          >
            Skip
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void onPromote(detection)}
            disabled={pending}
            data-state={pending ? 'loading' : undefined}
          >
            {pending ? 'Adding…' : 'Add to inventory'}
          </button>
        </>
      )}
    </>
  )
}

/** Normalized box → percentage offsets. Pixels never enter the renderer. */
function boxStyle(box: BoundingBox): React.CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  }
}
