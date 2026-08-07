'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ItemWithPrimaryPhoto } from '@/services/items'
import { blobUrl } from '@/lib/client/api'
import { StatusChip } from './StatusChip'

/**
 * The rail beside an item's detail.
 *
 * Fixing item 12 of 60 should cost a keypress, not a navigation out and back,
 * so J and K walk this list and the detail beside it follows. Each row is a
 * prefetched link, which is what keeps a keypress feeling like a keypress
 * rather than a page load.
 *
 * Escape goes back to the board carrying the cursor position, because landing
 * back at the top of a 60-card grid after editing one card in the middle is
 * its own small punishment.
 */
export function ItemRail({
  items,
  currentId,
  lotId,
  lotName,
  cursor,
}: {
  items: ItemWithPrimaryPhoto[]
  currentId: string
  lotId: string
  lotName: string
  cursor: number
}) {
  const router = useRouter()
  const currentRef = useRef<HTMLAnchorElement>(null)
  const index = items.findIndex((i) => i.id === currentId)

  // Walking with the keyboard scrolls past the visible rows quickly, and a
  // current row you cannot see is worse than no current row at all.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' })
  }, [currentId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
        return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === 'j' || key === 'k') {
        event.preventDefault()
        const next = index + (key === 'j' ? 1 : -1)
        const target = items[next]
        if (target) router.push(railHref(target.id, lotId, next))
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        router.push(`/lots/${lotId}?cursor=${index >= 0 ? index : cursor}`)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items, lotId, cursor, router])

  return (
    <>
      <div className="rail__head">
        <Link className="backlink" href={`/lots/${lotId}?cursor=${cursor}`}>
          ‹ {lotName}
        </Link>
        <span className="label rail__count">
          {items.length} {items.length === 1 ? 'listing' : 'listings'}
        </span>
      </div>

      {items.map((item, i) => (
        <Link
          className="railrow"
          key={item.id}
          href={railHref(item.id, lotId, i)}
          data-current={item.id === currentId}
          ref={item.id === currentId ? currentRef : undefined}
          prefetch
        >
          {item.primaryPhotoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="railrow__thumb" src={blobUrl(item.primaryPhotoKey)} alt="" />
          ) : (
            <span className="railrow__thumb" aria-hidden="true" />
          )}
          <span className="railrow__body">
            <span className="railrow__title">{item.title}</span>
            <span className="railrow__price">
              {item.estimatedValueCents === null
                ? 'Not yet priced'
                : formatMoney(item.estimatedValueCents, item.currency)}
            </span>
          </span>
          {/* Glyph only: at 320px the word would push the title out. */}
          <StatusChip status={item.status} glyphOnly />
        </Link>
      ))}
    </>
  )
}

function railHref(itemId: string, lotId: string, index: number): string {
  return `/items/${itemId}?lot=${lotId}&cursor=${index}`
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}
