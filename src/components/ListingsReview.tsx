'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import type { EnrichmentRunProgress } from '@/services/enrichment'
import { needsReview } from '@/domain/item-status'
import {
  ApiError,
  blobUrl,
  exportUrl,
  getEnrichmentProgress,
  getExportPreview,
  nudgeQueue,
  updateItem,
  type ExportPreview,
} from '@/lib/client/api'
import { StatusChip } from './StatusChip'

const POLL_MS = 2000

/**
 * Written listings, waiting to be checked and exported.
 *
 * Two things are load-bearing here. Every price is labelled as an estimate
 * until a person says otherwise, and the export tells you how many you never
 * looked at — the moment of export is the last chance the app has to admit
 * that a number came from a model rather than a decision, and staying quiet
 * then would be its most consequential silence.
 */
export function ListingsReview({
  lotId,
  items: initialItems,
  progress: initialProgress,
}: {
  lotId: string
  items: ItemWithPrimaryPhoto[]
  progress: EnrichmentRunProgress
}) {
  const router = useRouter()
  const [progress, setProgress] = useState(initialProgress)
  const [items, setItems] = useState(initialItems)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ticking = useRef(false)

  const working = progress.pending > 0

  const refresh = useCallback(async () => {
    try {
      const next = await getEnrichmentProgress(lotId)
      setProgress(next)
      if (next.pending === 0) router.refresh()
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
  }, [lotId, router])

  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [working, refresh])

  useEffect(() => setItems(initialItems), [initialItems])

  useEffect(() => {
    if (working) return
    void getExportPreview(lotId)
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [working, lotId, items])

  async function approve(item: ItemWithPrimaryPhoto) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, status: 'confirmed', priceUnconfirmed: false } : i,
      ),
    )
    try {
      await updateItem(item.id, { status: 'confirmed', priceUnconfirmed: false })
      router.refresh()
    } catch (cause) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
      setError(cause instanceof ApiError ? cause.message : 'Could not approve that.')
    }
  }

  async function approveAll() {
    const pending = items.filter((i) => needsReview(i.status))
    if (pending.length === 0) return
    setBusy(true)
    try {
      for (const item of pending) await approve(item)
    } finally {
      setBusy(false)
    }
  }

  const unreviewed = items.filter((i) => needsReview(i.status))
  const ready = items.filter((i) => i.status === 'confirmed' || i.status === 'listed')

  return (
    <>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1>{working ? 'Writing your listings…' : 'Check before you export'}</h1>
          <p className="lede">
            {working
              ? `${progress.done} of ${progress.requested} done. Each one is identified, priced against what Sorta can find online, and written up.`
              : 'Every price is an estimate until you say otherwise. Tap a listing to read and edit it.'}
          </p>
        </div>

        {working ? (
          <p className="working">
            <span className="working__dot" aria-hidden="true" />
            {progress.done} of {progress.requested}
          </p>
        ) : null}

        {error ? (
          <p className="notice notice--danger" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : null}

        {unreviewed.length > 0 ? (
          <div className="selectbar">
            <span className="label">{unreviewed.length} to check</span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => void approveAll()}
              disabled={busy}
              data-state={busy ? 'loading' : undefined}
            >
              {busy ? 'Approving…' : 'Approve all'}
            </button>
          </div>
        ) : null}

        <div className="board">
          {items.map((item) => (
            <article className="listing" key={item.id}>
              <Link className="listing__figure" href={`/items/${item.id}`}>
                {item.primaryPhotoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blobUrl(item.primaryPhotoKey)} alt="" loading="lazy" />
                ) : (
                  <span className="thumb thumb--lg" aria-hidden="true" />
                )}
              </Link>
              <div className="listing__body">
                <Link className="listing__title" href={`/items/${item.id}`}>
                  {item.title}
                </Link>
                {item.estimatedValueCents === null ? (
                  <span className="meta">Not priced</span>
                ) : (
                  <span className="listing__price" data-unconfirmed={item.priceUnconfirmed}>
                    {formatMoney(item.estimatedValueCents, item.currency)}
                  </span>
                )}
              </div>
              <div className="listing__foot">
                <StatusChip status={item.status} />
                {needsReview(item.status) ? (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void approve(item)}
                  >
                    Approve
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {!working && preview ? (
          <section className="panel">
            <div className="panel__head">
              <span className="label">Export</span>
              <span className="label">{preview.rowCount} rows</span>
            </div>
            <div className="panel__body stack">
              {preview.unconfirmedPrices > 0 ? (
                <p className="notice">
                  <span aria-hidden="true">◆</span>
                  <span>
                    {preview.unconfirmedPrices}{' '}
                    {preview.unconfirmedPrices === 1 ? 'price is' : 'prices are'} still Sorta’s
                    estimate — nobody has checked {preview.unconfirmedPrices === 1 ? 'it' : 'them'}
                    .
                  </span>
                </p>
              ) : null}
              {preview.skipped.slice(0, 4).map((s) => (
                <p className="meta" key={`${s.itemId}-${s.field}`}>
                  {s.message}
                </p>
              ))}
              <p className="meta">
                This is Facebook’s <strong>catalogue feed</strong> format, which needs a
                Commerce Manager business catalogue. Selling privately on Marketplace? Open an
                item and use <strong>Share</strong> — photos and copy go straight into the
                Facebook app.
              </p>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="actionbar">
        <span className="actionbar__note">
          {working
            ? 'This keeps going if you leave.'
            : `${ready.length} approved · ${unreviewed.length} unchecked`}
        </span>
        <button type="button" className="btn" disabled title="eBay publishing is not built yet">
          eBay
        </button>
        <a
          className="btn btn--primary"
          href={exportUrl(lotId)}
          download
          aria-disabled={working || (preview?.rowCount ?? 0) === 0}
        >
          Export CSV
        </a>
      </aside>
    </>
  )
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
