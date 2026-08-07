'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import { isDraft, needsReview } from '@/domain/item-status'
import { exportReadiness } from '@/domain/export-readiness'
import { ApiError, blobUrl, nudgeQueue, requestEnrichment, updateItem } from '@/lib/client/api'
import { StatusChip } from './StatusChip'
import { ExportButton } from './ExportButton'

/** How long an undo stays offered. Long enough to change your mind, short
 *  enough that it is not a permanent bar across the grid. */
const UNDO_MS = 6_000

/** How often the board takes its turn at draining the queue. */
const DRAIN_MS = 2500
/** About four minutes, after which an item that will never enrich stops asking. */
const MAX_DRAIN_TICKS = 96

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
  // The same question the export asks, so the number beside the button and
  // the number inside the dialog can never disagree.
  const readyCount = items.filter((i) => exportReadiness(i).ready).length

  /*
   * Items still waiting to be written up.
   *
   * Grouping enqueues one enrichment job per item, and on a serverless host
   * nothing drains the queue between requests: the progress screen polls
   * until grouping finishes and then stops, which is the exact moment the
   * enrichment work begins. Whoever is looking at unfinished work has to be
   * the one who moves it along, so this screen takes its turn, the same way
   * the progress and listings screens take theirs. Without it the board sits
   * on "Not yet priced" until the daily cron happens to run.
   */
  const awaiting = items.filter(
    (i) => i.estimatedValueCents === null && isDraft(i.status),
  ).length

  useEffect(() => {
    if (awaiting === 0) return

    // Enrichment is two model calls an item, so a lot arrives over a couple of
    // minutes. The cap stops a permanently failing item from polling forever.
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      if (ticks > MAX_DRAIN_TICKS) {
        clearInterval(timer)
        return
      }
      void nudgeQueue()
        .then(() => router.refresh())
        .catch(() => {
          // A dropped nudge is not worth surfacing; the next tick retries.
        })
    }, DRAIN_MS)

    return () => clearInterval(timer)
  }, [awaiting, router])

  /*
   * Prices land on the server, so the refresh above arrives as new props. The
   * board keeps its own list to make binning optimistic, and replacing that
   * wholesale would resurrect whatever was just binned; merging by id takes
   * the fresh fields for rows still on the board and leaves the rest alone.
   */
  useEffect(() => {
    setItems((prev) => {
      const fresh = new Map(initialItems.map((i) => [i.id, i]))
      return prev.map((item) => fresh.get(item.id) ?? item)
    })
  }, [initialItems])

  /* Anything that is not binning ends the undo window. */
  const clearUndo = useCallback(() => setBinned([]), [])

  /*
   * And so does time. The toast used to sit until the next non-binning
   * action, which on a phone meant a bar across the middle of the grid for as
   * long as someone kept binning, covering the cards they were trying to
   * judge. Each bin restarts the clock, so a run of them keeps one undo
   * available throughout.
   */
  useEffect(() => {
    if (binned.length === 0) return
    const timer = setTimeout(() => setBinned([]), UNDO_MS)
    return () => clearTimeout(timer)
  }, [binned])

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
      <div className="row row--between">
        <span className="label">
          {selected.size > 0 ? `${selected.size} selected` : `${items.length} listings`}
        </span>
        <button
          type="button"
          className="btn btn--sm btn--quiet"
          onClick={() =>
            setSelected(
              selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)),
            )
          }
        >
          {selected.size === items.length && items.length > 0 ? 'Select none' : 'Select all'}
        </button>
      </div>

      {reviewable.length > 0 ? (
        <Link className="notice notice--accent" href={`/lots/${lotId}/listings`}>
          <span aria-hidden="true">◆</span>
          <span>
            {reviewable.length} {reviewable.length === 1 ? 'listing is' : 'listings are'} written
            and waiting for you to check {reviewable.length === 1 ? 'it' : 'them'} →
          </span>
        </Link>
      ) : null}

      {/*
        A grid of links with a checkbox on each, not a listbox. Tapping a card
        used to select it and tapping its title silently navigated, with
        nothing on the card to say which did what. Open-on-tap and a visible
        tick are the two conventions people already have.
      */}
      <div className="board">
        {items.map((item, index) => {
          const isSelected = selected.has(item.id)
          const readiness = exportReadiness(item)
          return (
            <article
              className="listing enter"
              key={item.id}
              ref={(node) => {
                if (node) cardRefs.current.set(item.id, node)
                else cardRefs.current.delete(item.id)
              }}
              data-selected={isSelected}
              data-cursor={index === cursor}
            >
              {/*
                The picture is the selection target, and editing is a button.
                A link stretched over the whole card meant every mis-tap while
                picking things to bin landed on a detail screen, which is a
                long way back from where you were.
              */}
              <button
                type="button"
                className="listing__figure listing__pick"
                aria-pressed={isSelected}
                aria-label={`Select ${item.title}`}
                onClick={() => {
                  setCursor(index)
                  toggle(item.id)
                }}
              >
                {item.primaryPhotoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={blobUrl(item.primaryPhotoKey)} alt="" loading="lazy" />
                ) : (
                  <span className="thumb thumb--lg" aria-hidden="true" />
                )}
                {item.photoCount > 1 ? (
                  <span className="listing__views">{item.photoCount} views</span>
                ) : null}
                {/* Always present, so selection is discoverable rather than a
                    state you find by accident. */}
                <span className="listing__select" data-on={isSelected} aria-hidden="true">
                  ✓
                </span>
              </button>

              <div className="listing__body">
                <span className="listing__title">{item.title}</span>
                {item.estimatedValueCents === null ? (
                  <span className="listing__price listing__price--none">Not yet priced</span>
                ) : (
                  <span className="listing__price" data-unconfirmed={item.priceUnconfirmed}>
                    {formatMoney(item.estimatedValueCents, item.currency)}
                  </span>
                )}
                <div className="listing__foot">
                  {/*
                    An approved item that is missing a price says so, rather
                    than claiming a readiness the export will not honour.
                  */}
                  {readiness.blocker ? (
                    <span className="chip chip--warn">
                      <span className="chip__glyph" aria-hidden="true">
                        ▲
                      </span>
                      {readiness.blocker}
                    </span>
                  ) : readiness.ready ? (
                    <span className="chip chip--ok">
                      <span className="chip__glyph" aria-hidden="true">
                        ●
                      </span>
                      Ready to export
                    </span>
                  ) : (
                    <StatusChip status={item.status} />
                  )}
                  <span className="listing__actions">
                    <Link
                      className="btn btn--sm"
                      href={`/items/${item.id}?cursor=${index}`}
                      onFocus={() => setCursor(index)}
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn--sm listing__bin"
                      onClick={() => void bin(item)}
                    >
                      Bin
                    </button>
                  </span>
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
          <kbd className="kbd kbd--desktop" aria-hidden="true">
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
            {awaiting > 0 ? (
              <span className="working">
                <span className="working__dot" aria-hidden="true" />
                Writing {awaiting} {awaiting === 1 ? 'listing' : 'listings'}
              </span>
            ) : readyCount > 0 ? (
              `${readyCount} ready to export`
            ) : (
              'Bin what you do not want to sell.'
            )}
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
