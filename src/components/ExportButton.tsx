'use client'

import { useRef, useState } from 'react'
import { exportUrl, getExportPreview, type ExportPreview } from '@/lib/client/api'

/**
 * Export, without the trip to another screen first.
 *
 * The old route sent the seller to a listings page that showed the same grid
 * they were already looking at, and the export itself was one more click after
 * that. What the moment actually needs is the one thing the board cannot say:
 * how many rows will be in the file, and what got left out of it. So that
 * arrives in a dialog over the board instead.
 *
 * The file is only offered once the preview says there is something in it. The
 * previous control was an anchor carrying `aria-disabled`, which styles a link
 * as unavailable and then lets the click through anyway: with nothing priced,
 * that downloaded a CSV containing nothing but its header row.
 */
export function ExportButton({ lotId }: { lotId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  async function open() {
    dialogRef.current?.showModal()
    setState('loading')
    setPreview(null)
    try {
      setPreview(await getExportPreview(lotId))
      setState('idle')
    } catch {
      setState('error')
    }
  }

  const rows = preview?.rowCount ?? 0
  const nothingToSend = preview !== null && rows === 0

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={() => void open()}>
        Export
      </button>

      <dialog className="sheet" ref={dialogRef}>
        <div className="sheet__body">
          <div className="row row--between">
            <h2>Export this lot</h2>
            <button
              type="button"
              className="btn btn--sm btn--quiet"
              onClick={() => dialogRef.current?.close()}
            >
              Close
            </button>
          </div>

          {state === 'loading' ? (
            <p className="working">
              <span className="working__dot" aria-hidden="true" />
              Checking what is ready
            </p>
          ) : null}

          {state === 'error' ? (
            <p className="notice notice--danger" role="alert">
              <span className="notice__glyph" aria-hidden="true">
                ■
              </span>
              <span>Could not read this lot. Nothing was exported.</span>
            </p>
          ) : null}

          {preview ? (
            <>
              <p className="label">
                {rows} {rows === 1 ? 'row' : 'rows'} ready
              </p>

              {/*
                The whole reason this dialog exists. An item with no price is
                left out of the feed rather than sent at 0.00, so a lot that
                has not been written up yet exports to nothing at all, and the
                seller should hear that here rather than from an empty file.
              */}
              {nothingToSend ? (
                <p className="notice notice--warn">
                  <span className="notice__glyph" aria-hidden="true">
                    ▲
                  </span>
                  <span>
                    Nothing has a price yet, so there is nothing to export. Select the items you
                    want on the board and write their listings first.
                  </span>
                </p>
              ) : null}

              {preview.unconfirmedPrices > 0 ? (
                <p className="notice notice--warn">
                  <span className="notice__glyph" aria-hidden="true">
                    ▲
                  </span>
                  <span>
                    {preview.unconfirmedPrices}{' '}
                    {preview.unconfirmedPrices === 1 ? 'price is' : 'prices are'} still an
                    estimate. Nobody has checked{' '}
                    {preview.unconfirmedPrices === 1 ? 'it' : 'them'}.
                  </span>
                </p>
              ) : null}

              {preview.skipped.length > 0 && !nothingToSend ? (
                <ul className="steps">
                  {preview.skipped.slice(0, 4).map((s) => (
                    <li key={`${s.itemId}-${s.field}`}>{s.message}</li>
                  ))}
                  {preview.skipped.length > 4 ? (
                    <li>and {preview.skipped.length - 4} more left out.</li>
                  ) : null}
                </ul>
              ) : null}

              <p className="meta">
                This is Facebook’s catalogue feed format, which needs a Commerce Manager business
                catalogue. Selling privately? Open an item and use Share instead.
              </p>
            </>
          ) : null}

          <div className="row">
            <button type="button" className="btn" disabled title="eBay publishing is not built yet">
              eBay
            </button>
            {/* A real control, not a link dressed as a disabled one. */}
            {rows > 0 ? (
              <a
                className="btn btn--primary"
                href={exportUrl(lotId)}
                download
                onClick={() => dialogRef.current?.close()}
              >
                Download CSV
              </a>
            ) : (
              <button type="button" className="btn btn--primary" disabled>
                Download CSV
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  )
}
