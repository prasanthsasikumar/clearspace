'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { BatchProgress as Progress } from '@/services/batches'
import { getBatch } from '@/lib/client/api'

const POLL_MS = 1200

/**
 * The waiting screen.
 *
 * Thirty photos take a minute or two to work through, and a bare spinner over
 * that span reads as broken — people close the tab. So the counts move: photos
 * analysed, objects found, and finally items made. Each number is a promise
 * being kept in public, and the phase line names what is happening now rather
 * than showing a percentage nobody believes.
 */
export function BatchProgress({
  batchId,
  initial,
}: {
  batchId: string
  initial: Progress
}) {
  const router = useRouter()
  const [progress, setProgress] = useState(initial)

  const done = progress.phase === 'complete' || progress.phase === 'failed'

  const refresh = useCallback(async () => {
    try {
      setProgress(await getBatch(batchId))
    } catch {
      // A dropped poll is not worth surfacing; the next tick retries.
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

  return (
    <>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1>{headline(progress)}</h1>
          <p className="lede">{subhead(progress)}</p>
        </div>

        <section className="panel">
          <div className="panel__head">
            <span className="label">Progress</span>
            {done ? null : (
              <span className="working">
                <span className="working__dot" aria-hidden="true" />
                Working
              </span>
            )}
          </div>
          <div className="panel__body">
            <ul className="coverage">
              <Step
                done={progress.analysedCount === progress.photoCount}
                active={progress.phase === 'analysing'}
                name="Looking at each photo"
                value={`${progress.analysedCount} of ${progress.photoCount}`}
              />
              <Step
                done={progress.detectionCount > 0}
                active={progress.phase === 'analysing' && progress.detectionCount > 0}
                name="Finding objects"
                value={progress.detectionCount === 0 ? '—' : String(progress.detectionCount)}
              />
              <Step
                done={progress.phase === 'complete'}
                active={progress.phase === 'grouping'}
                name="Matching the same thing across photos"
                value={
                  progress.phase === 'complete'
                    ? `${progress.itemCount} items`
                    : progress.phase === 'grouping'
                      ? 'now'
                      : 'waiting'
                }
              />
            </ul>
          </div>
        </section>

        {progress.failedCount > 0 ? (
          <p className="notice">
            <span aria-hidden="true">◆</span>
            <span>
              {progress.failedCount} of {progress.photoCount}{' '}
              {progress.failedCount === 1 ? 'photo' : 'photos'} could not be analysed. The rest
              went through.
            </span>
          </p>
        ) : null}

        {progress.phase === 'failed' ? (
          <p className="notice notice--danger" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>This upload could not be processed. Your photos are still saved.</span>
          </p>
        ) : null}

        {progress.phase === 'complete' && progress.multiViewItems ? (
          <p className="notice notice--accent">
            <span aria-hidden="true">◆</span>
            <span>
              {progress.multiViewItems}{' '}
              {progress.multiViewItems === 1 ? 'item was' : 'items were'} photographed more than
              once, so {progress.multiViewItems === 1 ? 'it has' : 'they have'} several views
              already.
            </span>
          </p>
        ) : null}
      </div>

      <aside className="actionbar">
        <span className="actionbar__note">
          {progress.phase === 'complete'
            ? 'Bin what you do not want to sell.'
            : 'You can leave this screen — it keeps going.'}
        </span>
        <Link className={progress.phase === 'complete' ? 'btn btn--primary' : 'btn'} href={`/lots/${progress.lotId}`}>
          {progress.phase === 'complete' ? `See ${progress.itemCount} items` : 'Back to lot'}
        </Link>
      </aside>
    </>
  )
}

function Step({
  done,
  active,
  name,
  value,
}: {
  done: boolean
  active?: boolean
  name: string
  value: string
}) {
  return (
    <li className="coverage__item" data-done={done} data-active={!done && active}>
      <span className="coverage__mark" aria-hidden="true">
        {done ? '✓' : active ? '◆' : '○'}
      </span>
      <span className="coverage__name">{name}</span>
      <span className="label">{value}</span>
    </li>
  )
}

function headline(progress: Progress): string {
  switch (progress.phase) {
    case 'complete':
      return progress.itemCount === 0
        ? 'Nothing found in those photos'
        : `${progress.itemCount} things to sell`
    case 'failed':
      return 'That did not work'
    case 'grouping':
      return 'Working out what is what…'
    default:
      return 'Going through your photos…'
  }
}

function subhead(progress: Progress): string {
  switch (progress.phase) {
    case 'complete':
      return progress.itemCount === 0
        ? 'Try again with more light, or closer in.'
        : 'Each one is a draft listing. Bin the ones you do not want.'
    case 'failed':
      return 'Nothing was lost. You can upload the same photos again.'
    case 'grouping':
      return 'Matching the same object across the photos it appeared in.'
    default:
      return 'This takes a minute or two. It carries on if you close the app.'
  }
}
