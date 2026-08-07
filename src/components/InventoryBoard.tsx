'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import { isDraft, needsReview } from '@/domain/item-status'
import { ApiError, blobUrl, requestEnrichment, updateItem } from '@/lib/client/api'
import { StatusChip } from './StatusChip'

interface Binned {
  item: ItemWithPrimaryPhoto
  previousStatus: string
}

/**
 * The triage board — the only screen the user is obliged to touch.
 *
 * Everything arrives already selected, because after photographing a space
 * most of what came back is worth keeping and the work should be subtraction,
 * not assembly. Tap a card to drop it. Tap the title to open it. Then one
 * button turns the survivors into written listings.
 *
 * Binning is optimistic and reversible. Sixty confirmation dialogs is exactly
 * the ceremony this whole redesign exists to delete.
 */
export function InventoryBoard({
  lotId,
  items: initialItems,
}: {
  lotId: string
  items: ItemWithPrimaryPhoto[]
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialItems.filter((i) => isDraft(i.status)).map((i) => i.id)),
  )
  const [binned, setBinned] = useState<Binned | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drafts = useMemo(() => items.filter((i) => isDraft(i.status)), [items])
  const reviewable = useMemo(() => items.filter((i) => needsReview(i.status)), [items])
  const selectedDrafts = drafts.filter((i) => selected.has(i.id))
  const allSelected = drafts.length > 0 && selectedDrafts.length === drafts.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(drafts.map((i) => i.id)))
  }

  async function bin(item: ItemWithPrimaryPhoto) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    setBinned({ item, previousStatus: item.status })
    setError(null)
    try {
      await updateItem(item.id, { status: 'discarded' })
      router.refresh()
    } catch {
      setItems((prev) => [item, ...prev])
      setBinned(null)
      setError('Could not bin that one.')
    }
  }

  async function undo() {
    if (!binned) return
    const { item, previousStatus } = binned
    setBinned(null)
    setItems((prev) => [item, ...prev])
    try {
      await updateItem(item.id, { status: previousStatus })
      router.refresh()
    } catch {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setError('Could not bring that one back.')
    }
  }

  async function writeListings() {
    if (selectedDrafts.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await requestEnrichment(
        lotId,
        selectedDrafts.map((i) => i.id),
      )
      router.push(`/lots/${lotId}/listings`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not start that.')
      setBusy(false)
    }
  }

  return (
    <>
      {drafts.length > 0 ? (
        <div className="selectbar">
          <span className="label">
            {selectedDrafts.length} of {drafts.length} selected
          </span>
          <button type="button" className="btn btn--sm btn--quiet" onClick={toggleAll}>
            {allSelected ? 'Select none' : 'Select all'}
          </button>
        </div>
      ) : null}

      {reviewable.length > 0 ? (
        <Link className="notice notice--accent" href={`/lots/${lotId}/listings`}>
          <span aria-hidden="true">◆</span>
          <span>
            {reviewable.length} {reviewable.length === 1 ? 'listing is' : 'listings are'} written
            and waiting for you to check {reviewable.length === 1 ? 'it' : 'them'} →
          </span>
        </Link>
      ) : null}

      <div className="board">
        {items.map((item) => {
          const draft = isDraft(item.status)
          const isSelected = draft && selected.has(item.id)
          return (
            <article
              className="listing enter"
              key={item.id}
              data-selected={draft ? isSelected : undefined}
              onClick={draft ? () => toggle(item.id) : undefined}
              role={draft ? 'checkbox' : undefined}
              aria-checked={draft ? isSelected : undefined}
              aria-label={draft ? item.title : undefined}
              tabIndex={draft ? 0 : undefined}
              onKeyDown={
                draft
                  ? (event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault()
                        toggle(item.id)
                      }
                    }
                  : undefined
              }
            >
              {draft ? (
                <span className="listing__check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
              ) : null}

              <span className="listing__figure">
                {item.primaryPhotoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blobUrl(item.primaryPhotoKey)} alt="" loading="lazy" />
                ) : (
                  <span className="thumb thumb--lg" aria-hidden="true" />
                )}
                {item.photoCount > 1 ? (
                  <span className="listing__views">{item.photoCount} views</span>
                ) : null}
              </span>

              <div className="listing__body">
                <Link
                  className="listing__title"
                  href={`/items/${item.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.title}
                </Link>
                {item.estimatedValueCents === null ? (
                  <span className="meta">Not yet priced</span>
                ) : (
                  <span className="listing__price" data-unconfirmed={item.priceUnconfirmed}>
                    {formatMoney(item.estimatedValueCents, item.currency)}
                  </span>
                )}
              </div>

              <div className="listing__foot">
                <StatusChip status={item.status} />
                <button
                  type="button"
                  className="btn btn--sm btn--quiet"
                  onClick={(e) => {
                    e.stopPropagation()
                    void bin(item)
                  }}
                >
                  Bin
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {binned ? (
        <p className="toast toast--neutral" role="status">
          <span>Binned “{binned.item.title}”.</span>
          <button type="button" className="btn btn--sm" onClick={() => void undo()}>
            Undo
          </button>
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

      <aside className="actionbar">
        <span className="actionbar__note">
          {selectedDrafts.length > 0
            ? 'Sorta writes each one and prices it.'
            : reviewable.length > 0
              ? 'Check the listings, then export.'
              : 'Tap a card to put it back.'}
        </span>
        {selectedDrafts.length > 0 ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void writeListings()}
            disabled={busy}
            data-state={busy ? 'loading' : undefined}
          >
            {busy ? 'Starting…' : `Next · ${selectedDrafts.length}`}
          </button>
        ) : (
          <Link className="btn btn--primary" href={`/lots/${lotId}/listings`}>
            Listings
          </Link>
        )}
      </aside>
    </>
  )
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
