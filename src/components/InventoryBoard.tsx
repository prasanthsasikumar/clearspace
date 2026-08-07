'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import { isDraft, needsReview } from '@/domain/item-status'
import { ApiError, blobUrl, requestEnrichment, updateItem } from '@/lib/client/api'
import { StatusChip } from './StatusChip'
import { ExportButton } from './ExportButton'

interface Binned {
  item: ItemWithPrimaryPhoto
  previousStatus: string
}

/**
 * The triage board: the only screen the user is obliged to touch.
 *
 * Pruning has to have rhythm, so on a keyboard it is J/K to walk, B to bin, X
 * to select, U to undo, Enter to open. The cursor is a ring rather than a
 * selection, which is why arriving here selects nothing: a board that arrives
 * with all 25 already ticked has made the decision for you, and the graphite
 * bar that comes with it reads as a permanent mode instead of the answer to
 * something you did.
 *
 * Binning is optimistic and reversible. Sixty confirmation dialogs is exactly
 * the ceremony this whole screen exists to delete, so the toast accumulates
 * instead and survives until the next thing you do that is not binning.
 */
export function InventoryBoard({
  lotId,
  items: initialItems,
  initialCursor = 0,
}: {
  lotId: string
  items: ItemWithPrimaryPhoto[]
  initialCursor?: number
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = useState(() =>
    Number.isFinite(initialCursor) && initialCursor > 0
      ? Math.min(initialCursor, Math.max(0, initialItems.length - 1))
      : 0,
  )
  const [binned, setBinned] = useState<Binned[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRefs = useRef(new Map<string, HTMLElement>())

  const reviewable = useMemo(() => items.filter((i) => needsReview(i.status)), [items])
  const selectedItems = items.filter((i) => selected.has(i.id))
  const selectedDrafts = selectedItems.filter((i) => isDraft(i.status))
  // What the feed would actually carry. An item with no price is left out of
  // it, so this is the honest count to put next to an Export button.
  const readyCount = items.filter((i) => i.estimatedValueCents !== null).length

  /* Anything that is not binning ends the undo window. */
  const clearUndo = useCallback(() => setBinned([]), [])

  function toggle(id: string) {
    clearUndo()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bin = useCallback(
    async (item: ItemWithPrimaryPhoto) => {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      setSelected((prev) => {
        if (!prev.has(item.id)) return prev
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      setBinned((prev) => [...prev, { item, previousStatus: item.status }])
      setError(null)
      try {
        await updateItem(item.id, { status: 'discarded' })
        router.refresh()
      } catch {
        setItems((prev) => [item, ...prev])
        setBinned((prev) => prev.filter((b) => b.item.id !== item.id))
        setError('Could not bin that one.')
      }
    },
    [router],
  )

  const undo = useCallback(async () => {
    if (binned.length === 0) return
    const restoring = binned
    setBinned([])
    setItems((prev) => [...restoring.map((b) => b.item), ...prev])
    try {
      await Promise.all(
        restoring.map((b) => updateItem(b.item.id, { status: b.previousStatus })),
      )
      router.refresh()
    } catch {
      const ids = new Set(restoring.map((b) => b.item.id))
      setItems((prev) => prev.filter((i) => !ids.has(i.id)))
      setError('Could not bring those back.')
    }
  }, [binned, router])

  async function binSelected() {
    const targets = selectedItems
    setSelected(new Set())
    for (const item of targets) await bin(item)
  }

  async function writeListings() {
    if (selectedDrafts.length === 0) return
    clearUndo()
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

  /*
   * The keyboard is the whole point of the desktop board, so the handler is on
   * the window rather than on a focused card: walking a 60-item grid should
   * not depend on which card happens to hold focus. Typing in a field is the
   * one case that has to be left alone.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (items.length === 0) return

      const key = event.key.toLowerCase()
      const current = items[Math.min(cursor, items.length - 1)]

      if (key === 'j' || key === 'k') {
        event.preventDefault()
        const delta = key === 'j' ? 1 : -1
        const next = Math.max(0, Math.min(items.length - 1, cursor + delta))
        setCursor(next)
        // Shift extends the selection as the cursor moves, the one way to
        // select a run without clicking each card.
        if (event.shiftKey && items[next]) {
          const id = items[next].id
          setSelected((prev) => new Set(prev).add(id))
        }
        cardRefs.current.get(items[next]?.id ?? '')?.scrollIntoView({ block: 'nearest' })
        return
      }
      if (key === 'b' && current) {
        event.preventDefault()
        void bin(current)
        setCursor((c) => Math.min(c, items.length - 2 < 0 ? 0 : items.length - 2))
        return
      }
      if (key === 'x' && current) {
        event.preventDefault()
        toggle(current.id)
        return
      }
      if (key === 'u') {
        event.preventDefault()
        void undo()
        return
      }
      if (event.key === 'Enter' && current) {
        event.preventDefault()
        router.push(`/items/${current.id}?cursor=${cursor}`)
        return
      }
      if (event.key === 'Escape' && selected.size > 0) {
        event.preventDefault()
        setSelected(new Set())
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, cursor, selected.size, bin, undo, router])

  return (
    <>
      {reviewable.length > 0 ? (
        <Link className="notice notice--accent" href={`/lots/${lotId}/listings`}>
          <span aria-hidden="true">◆</span>
          <span>
            {reviewable.length} {reviewable.length === 1 ? 'listing is' : 'listings are'} written
            and waiting for you to check {reviewable.length === 1 ? 'it' : 'them'} →
          </span>
        </Link>
      ) : null}

      <div
        className="board"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Listings in this lot"
      >
        {items.map((item, index) => {
          const isSelected = selected.has(item.id)
          return (
            <article
              className="listing enter"
              key={item.id}
              ref={(node) => {
                if (node) cardRefs.current.set(item.id, node)
                else cardRefs.current.delete(item.id)
              }}
              role="option"
              aria-selected={isSelected}
              aria-label={item.title}
              data-selected={isSelected}
              data-cursor={index === cursor}
              tabIndex={index === cursor ? 0 : -1}
              onClick={() => {
                setCursor(index)
                toggle(item.id)
              }}
              onFocus={() => setCursor(index)}
            >
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
                {isSelected ? (
                  <span className="listing__check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </span>

              <div className="listing__body">
                <Link
                  className="listing__title"
                  href={`/items/${item.id}?cursor=${index}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.title}
                </Link>
                {item.estimatedValueCents === null ? (
                  <span className="listing__price listing__price--none">Not yet priced</span>
                ) : (
                  <span className="listing__price" data-unconfirmed={item.priceUnconfirmed}>
                    {formatMoney(item.estimatedValueCents, item.currency)}
                  </span>
                )}
                <div className="listing__foot">
                  <StatusChip status={item.status} />
                  <button
                    type="button"
                    className="btn btn--sm listing__bin"
                    onClick={(e) => {
                      e.stopPropagation()
                      void bin(item)
                    }}
                  >
                    Bin
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {binned.length > 0 ? (
        <p className="toast toast--neutral" role="status">
          <span>
            {binned.length === 1 ? `Binned “${binned[0]!.item.title}”` : `Binned ${binned.length}`}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => void undo()}>
            Undo
          </button>
          <kbd className="kbd" aria-hidden="true">
            U
          </kbd>
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

      {/*
        One bar at a time. The graphite selection bar is a mode you entered on
        purpose, so it replaces the action bar rather than stacking on top of
        it, and it leaves the moment the selection does.
      */}
      {selected.size > 0 ? (
        <aside className="selectbar" aria-label="Selection">
          <span className="label">{selected.size} selected</span>
          <button type="button" className="btn btn--onDark" onClick={() => void binSelected()}>
            Bin {selected.size}
          </button>
          {selectedDrafts.length > 0 ? (
            <button
              type="button"
              className="btn btn--quiet btn--onDark"
              onClick={() => void writeListings()}
              disabled={busy}
              data-state={busy ? 'loading' : undefined}
            >
              {busy ? 'Starting…' : `Write ${selectedDrafts.length}`}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--quiet btn--onDark"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <span className="selectbar__hint">⇧J extends · Esc clears</span>
        </aside>
      ) : (
        <aside className="actionbar">
          <span className="kbdrow" aria-hidden="true">
            <kbd className="kbd">J K</kbd>move
            <kbd className="kbd">B</kbd>bin
            <kbd className="kbd">X</kbd>select
            <kbd className="kbd">U</kbd>undo
            <kbd className="kbd">⏎</kbd>open
          </span>
          {/*
            Export is the next step from here, not adding more photos. The
            photos are already in: that offer belongs at the start of the loop
            and in the app bar for a second pass, not in the one slot on the
            screen reserved for what the seller came to do.
          */}
          <span className="actionbar__note">
            {readyCount > 0
              ? `${readyCount} ready to export`
              : 'Write the listings you want to sell, then export.'}
          </span>
          <ExportButton lotId={lotId} />
        </aside>
      )}
    </>
  )
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
