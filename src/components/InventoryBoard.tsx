'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import { blobUrl, updateItem } from '@/lib/client/api'
import { StatusChip } from './StatusChip'

interface Binned {
  item: ItemWithPrimaryPhoto
  previousStatus: string
}

/**
 * The board of auto-created listings — and the pruning that is now the user's
 * only obligatory job.
 *
 * Binning is optimistic and reversible: the card leaves immediately and an Undo
 * sits there until the user does something else. A confirmation dialog on every
 * bin would make pruning sixty items into sixty modals, which is precisely the
 * ceremony this redesign exists to remove. Nothing is deleted — binned items
 * move to `discarded` and can come back.
 */
export function InventoryBoard({
  items: initialItems,
}: {
  items: ItemWithPrimaryPhoto[]
}) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [binned, setBinned] = useState<Binned | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <>
      <div className="board">
        {items.map((item) => (
          <article className="listing enter" key={item.id}>
            <Link className="listing__figure" href={`/items/${item.id}`}>
              {item.primaryPhotoKey ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={blobUrl(item.primaryPhotoKey)} alt="" loading="lazy" />
              ) : (
                <span className="thumb thumb--lg" aria-hidden="true" />
              )}
              {item.photoCount > 1 ? (
                <span className="listing__views">{item.photoCount} views</span>
              ) : null}
            </Link>

            <div className="listing__body">
              <Link className="listing__title" href={`/items/${item.id}`}>
                {item.title}
              </Link>
              <span className="meta">
                {item.estimatedValueCents === null
                  ? 'Not yet priced'
                  : formatMoney(item.estimatedValueCents, item.currency)}
              </span>
            </div>

            <div className="listing__foot">
              <StatusChip status={item.status} />
              <button
                type="button"
                className="btn btn--sm btn--quiet"
                onClick={() => void bin(item)}
              >
                Bin
              </button>
            </div>
          </article>
        ))}
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
    </>
  )
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
