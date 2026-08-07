'use client'

import { useState } from 'react'
import type { Identification, Item, ItemPhoto, Valuation } from '@/db/schema'
import { blobUrl } from '@/lib/client/api'

export interface ListingDraftView {
  title: string
  description: string
  priceCents: number | null
}

/**
 * The generated listing, its price, and where that price came from.
 *
 * The sources are the point. A number the seller cannot trace is a number they
 * cannot defend to a buyer, and an app that produces confident prices with no
 * provenance is worse than one that produces none. When the research found
 * nothing, this says exactly that instead of quietly presenting a guess in the
 * same typeface as a researched figure.
 */
export function ListingPanel({
  item,
  photos,
  draft,
  valuation,
  identification,
  onPriceChange,
  onConfirmPrice,
}: {
  item: Item
  photos: readonly ItemPhoto[]
  draft: ListingDraftView | null
  valuation: Valuation | null
  identification: Identification | null
  onPriceChange: (cents: number) => void
  onConfirmPrice: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  if (!draft) {
    return (
      <section className="panel">
        <div className="panel__head">
          <span className="label">Listing</span>
        </div>
        <div className="panel__body">
          <p className="meta">
            Not written yet. Select this item on the board and tap Next to have Sorta identify,
            price, and write it.
          </p>
        </div>
      </section>
    )
  }

  const sources = (identification?.sources ?? []) as Array<{ title: string; url: string }>
  const unsourced = sources.length === 0
  const shareText = `${draft.title}\n\n${draft.description}\n\n${
    draft.priceCents !== null ? formatMoney(draft.priceCents, item.currency) : ''
  }`.trim()

  /**
   * One tap: photos and copy into the iOS share sheet, from which the seller
   * saves to Photos or drops straight into the Facebook app. There is no
   * public API to post a personal Marketplace listing, so this — not a CSV —
   * is the real "one click" for a private seller.
   */
  async function share() {
    setShareError(null)
    try {
      const files: File[] = []
      for (const photo of photos.slice(0, 6)) {
        const response = await fetch(blobUrl(photo.blobKey))
        const blob = await response.blob()
        files.push(new File([blob], `${slug(draft!.title)}-${files.length + 1}.jpg`, {
          type: blob.type || 'image/jpeg',
        }))
      }

      const payload: ShareData = { title: draft!.title, text: shareText }
      if (files.length > 0 && navigator.canShare?.({ files })) payload.files = files

      if (navigator.share) {
        await navigator.share(payload)
        return
      }
      // Desktop and anything without the Web Share API still gets the copy.
      await copy()
    } catch (error) {
      // A user dismissing the share sheet throws AbortError; that is not a fault.
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareError('Could not open the share sheet. The text has been copied instead.')
      await copy().catch(() => undefined)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <span className="label">Listing</span>
        {item.priceUnconfirmed ? (
          <span className="chip chip--warn">Estimate</span>
        ) : (
          <span className="chip chip--ok">You checked this</span>
        )}
      </div>

      <div className="panel__body stack">
        <div className="stack stack--tight">
          <span className="label">Title</span>
          <p className="rowlink__title">{draft.title}</p>
        </div>

        <div className="stack stack--tight">
          <span className="label">Description</span>
          <p className="prose">{draft.description}</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="listing-price">
            Asking price
          </label>
          <input
            id="listing-price"
            className="field__control"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={draft.priceCents === null ? '' : (draft.priceCents / 100).toFixed(2)}
            onChange={(e) => {
              const next = Number.parseFloat(e.target.value)
              if (Number.isFinite(next)) onPriceChange(Math.round(next * 100))
            }}
          />
          {valuation ? (
            <span className="meta">
              Sorta suggested {formatMoney(valuation.recommendedCents, item.currency)} — range{' '}
              {formatMoney(valuation.lowCents, item.currency)} to{' '}
              {formatMoney(valuation.highCents, item.currency)}.
            </span>
          ) : null}
        </div>

        <div className="stack stack--tight">
          <span className="label">Where this price came from</span>
          {unsourced ? (
            <p className="notice">
              <span aria-hidden="true">◆</span>
              <span>
                No sources. {valuation?.method ?? 'This figure is an estimate, not research.'}{' '}
                Check it against a couple of live listings before you post.
              </span>
            </p>
          ) : (
            <>
              <p className="meta">{valuation?.method}</p>
              <ul className="coverage">
                {sources.slice(0, 6).map((source) => (
                  <li className="coverage__item" key={source.url}>
                    <span className="coverage__mark" aria-hidden="true">
                      ↗
                    </span>
                    <a
                      className="coverage__name"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {shareError ? (
          <p className="notice notice--danger" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{shareError}</span>
          </p>
        ) : null}

        <div className="row">
          <button type="button" className="btn btn--primary" onClick={() => void share()}>
            Share
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void copy()}
            data-state={copied ? 'success' : undefined}
          >
            {copied ? 'Copied' : 'Copy text'}
          </button>
          {item.priceUnconfirmed ? (
            <button type="button" className="btn" onClick={onConfirmPrice}>
              Price looks right
            </button>
          ) : null}
        </div>

        <p className="meta">
          Share puts the photos and this text into your phone’s share sheet — save them to
          Photos, or send them straight to the Facebook app and paste.
        </p>
      </div>
    </section>
  )
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
}
