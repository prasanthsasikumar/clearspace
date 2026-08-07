'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BatchProgress as Progress } from '@/services/batches'
import { getBatch, nudgeQueue } from '@/lib/client/api'

const POLL_MS = 1200

/**
 * The waiting screen.
 *
 * Thirty photos take a minute or two to work through, and a bare spinner over
 * that span reads as broken: people close the tab. So the counts move, polled
 * about once a second, and the headline names the phase rather than showing a
 * percentage nobody believes. Counts are mono and tabular because a number
 * that jitters as its digits change width looks like a fault.
 */
export function BatchProgress({ batchId, initial }: { batchId: string; initial: Progress }) {
  const router = useRouter()
  const [progress, setProgress] = useState(initial)
  // A tick can outlast the poll interval, so overlapping calls are skipped
  // rather than stacking function invocations on top of each other.
  const ticking = useRef(false)

  const done = progress.phase === 'complete' || progress.phase === 'failed'

  const refresh = useCallback(async () => {
    try {
      setProgress(await getBatch(batchId))
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
    }

    if (ticking.current) return
    ticking.current = true
    try {
      await nudgeQueue()
    } finally {
      ticking.current = false
    }
  }, [batchId])

  useEffect(() => {
    if (done) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [done, refresh])

  useEffect(() => {
    // Once items exist, the lot page behind this screen is stale.
    if (progress.phase === 'complete') router.refresh()
  }, [progress.phase, router])

  const photosDone = progress.analysedCount === progress.photoCount

  return (
    <div className="stack stack--loose">
      <div className="workinghead">
        {done ? null : <span className="spinner" aria-hidden="true" />}
        <div className="stack stack--tight">
          <Eyebrow phase={progress.phase} />
          <h1>{headline(progress)}</h1>
        </div>
      </div>
      <p className="lede">{subhead(progress)}</p>

      {progress.phase === 'failed' ? null : (
        <section className="panel">
          <ProgressRow
            name="Looking at each photo"
            done={photosDone}
            active={!photosDone}
            value={`${progress.analysedCount} of ${progress.photoCount}`}
            // The only phase whose total is known ahead of time, so it is the
            // only one that gets a real bar. Guessing at the others would be
            // a progress bar that lies, which is worse than none.
            fraction={
              progress.photoCount > 0 ? progress.analysedCount / progress.photoCount : 0
            }
          />
          <ProgressRow
            name="Finding objects"
            done={photosDone && progress.detectionCount > 0}
            active={!photosDone && progress.detectionCount > 0}
            value={progress.detectionCount === 0 ? 'waiting' : String(progress.detectionCount)}
            pending={progress.detectionCount === 0}
          />
          <ProgressRow
            name="Matching the same thing across photos"
            done={progress.phase === 'complete'}
            active={progress.phase === 'grouping'}
            value={
              progress.phase === 'complete'
                ? `${progress.itemCount} items`
                : progress.phase === 'grouping'
                  ? 'now'
                  : 'waiting'
            }
            pending={progress.phase !== 'complete' && progress.phase !== 'grouping'}
          />
        </section>
      )}

      {/*
        The reassurance line, and where the cross-photo grouping work finally
        surfaces to the person who paid for it in waiting.
      */}
      {progress.phase === 'complete' && progress.multiViewItems ? (
        <p className="notice notice--ok">
          <span className="notice__glyph" aria-hidden="true">
            ●
          </span>
          <span>
            {progress.multiViewItems}{' '}
            {progress.multiViewItems === 1 ? 'item was' : 'items were'} photographed more than
            once, so {progress.multiViewItems === 1 ? 'it has' : 'they have'} several views
            already.
          </span>
        </p>
      ) : null}

      {progress.failedCount > 0 ? (
        <p className="notice notice--warn">
          <span className="notice__glyph" aria-hidden="true">
            ▲
          </span>
          <span>
            {progress.failedCount} of {progress.photoCount}{' '}
            {progress.failedCount === 1 ? 'photo' : 'photos'} could not be analysed. The rest went
            through.
          </span>
        </p>
      ) : null}

      {/* Failure copy leads with what was not lost. */}
      {progress.phase === 'failed' ? (
        <p className="notice notice--danger" role="alert">
          <span className="notice__glyph" aria-hidden="true">
            ■
          </span>
          <span>Nothing was lost. You can upload the same photos again.</span>
        </p>
      ) : null}

      {progress.phase === 'failed' ? (
        <div className="stack stack--tight">
          <Link className="btn btn--primary btn--block btn--lg" href={`/lots/${progress.lotId}/capture`}>
            Upload again
          </Link>
          <Link className="btn btn--block" href={`/lots/${progress.lotId}`}>
            Back to the lot
          </Link>
        </div>
      ) : progress.phase === 'complete' ? (
        <div className="stack stack--tight">
          <Link className="btn btn--primary btn--block btn--lg" href={`/lots/${progress.lotId}`}>
            Open the board
          </Link>
        </div>
      ) : (
        <Link className="backlink" href={`/lots/${progress.lotId}`}>
          ‹ Back to the lot, this keeps going
        </Link>
      )}
    </div>
  )
}

function Eyebrow({ phase }: { phase: Progress['phase'] }) {
  if (phase === 'complete') {
    return (
      <span className="eyebrow eyebrow--ok">
        <span aria-hidden="true">✓</span> Done
      </span>
    )
  }
  if (phase === 'failed') {
    return (
      <span className="eyebrow eyebrow--danger">
        <span aria-hidden="true">■</span> Failed
      </span>
    )
  }
  return (
    <span className="eyebrow">
      <span className="working__dot" aria-hidden="true" />
      Working
    </span>
  )
}

function ProgressRow({
  name,
  value,
  done,
  active,
  pending,
  fraction,
}: {
  name: string
  value: string
  done: boolean
  active?: boolean
  pending?: boolean
  /** 0 to 1, for the one phase whose total is known. */
  fraction?: number
}) {
  return (
    <div className="progrow" data-done={done} data-active={!done && active}>
      <span className="progrow__name" data-pending={pending && !active}>
        {name}
      </span>
      <span className="progrow__value">
        {done ? (
          <span className="progrow__mark enter" aria-hidden="true">
            ✓
          </span>
        ) : active ? (
          <span className="working__dot" aria-hidden="true" />
        ) : null}
        {/*
          Keyed on the value so a changed count remounts and arrives with the
          row-insert motion. Two minutes of a number that never visibly moves
          reads as a stall, and the count is the only evidence this screen has
          that anything is happening.
        */}
        <span className="progrow__count enter" key={value}>
          {value}
        </span>
      </span>

      {fraction !== undefined && !done ? (
        <span
          className="progrow__bar"
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, fraction))})` }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  )
}

/* "Reading your photos…" to "Matching things across photos…" to "18 things to
   sell." The headline is the only place the phase is stated in words. */
function headline(progress: Progress): string {
  switch (progress.phase) {
    case 'complete':
      return progress.itemCount === 0
        ? 'Nothing found in those photos.'
        : `${progress.itemCount} things to sell.`
    case 'failed':
      return 'That did not work.'
    case 'grouping':
      return 'Matching things across photos…'
    default:
      return 'Reading your photos…'
  }
}

function subhead(progress: Progress): string {
  switch (progress.phase) {
    case 'complete':
      return progress.itemCount === 0
        ? 'Try again with more light, or closer in.'
        : 'Each one is a draft listing. Bin the ones you do not want.'
    case 'failed':
      return 'Your photos are still here.'
    default:
      return 'This takes a minute or two. It carries on if you close the app.'
  }
}
