import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { InventoryBoard } from '@/components/InventoryBoard'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { listItems } from '@/services/items'
import { listScansForLot } from '@/services/scans'
import { requireSessionUser } from '@/server/auth'
import { getBatchProgress } from '@/services/batches'
import { blobUrl } from '@/lib/client/api'

export const dynamic = 'force-dynamic'

export default async function LotPage({
  params,
  searchParams,
}: {
  params: Promise<{ lotId: string }>
  searchParams: Promise<{ cursor?: string }>
}) {
  const { lotId } = await params
  // Where the keyboard was when the user left for an item's detail. Coming
  // back to the top of a 60-card grid after editing card 34 is its own small
  // punishment, so the position rides along in the URL.
  const { cursor } = await searchParams
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) notFound()

  const [items, scans] = await Promise.all([listItems(db, lot.id), listScansForLot(db, lot.id)])
  const live = items.filter((item) => item.status !== 'discarded')
  const binned = items.length - live.length

  // The most recent upload, so a batch still being worked on stays visible.
  const latestBatchId = scans.filter((s) => s.batchId).at(-1)?.batchId
  const batch = latestBatchId ? await getBatchProgress(db, latestBatchId) : null
  const working = batch !== null && batch.phase !== 'complete' && batch.phase !== 'failed'

  return (
    <div className="shell">
      <AppBar
        back={{ href: '/', label: 'Lots' }}
        title={lot.name}
        action={
          live.length > 0 ? (
            <Link className="btn btn--quiet btn--sm" href={`/lots/${lot.id}/listings`}>
              Export
            </Link>
          ) : null
        }
      />

      {/*
        The strip the progress page collapses into. Full-bleed above the board
        rather than a card inside it, because it describes work happening to
        the whole lot, and because pruning is meant to start underneath it
        while the rest of the batch is still going through.
      */}
      {working ? (
        <Link className="workstrip" href={`/batches/${batch.batchId}`}>
          <span className="working__dot" aria-hidden="true" />
          <span className="workstrip__text">
            Working · {batch.analysedCount} of {batch.photoCount} photos · new items appear below
            as they finish
          </span>
          <span className="workstrip__more">Details ›</span>
        </Link>
      ) : null}

      <main className={live.length === 0 ? 'page' : 'page page--wide page--barred'}>
        <div className="stack stack--loose">
          {live.length > 0 ? (
            <div className="boardhead">
              <span className="label">
                {live.length} {live.length === 1 ? 'listing' : 'listings'}
                {binned > 0 ? ` · ${binned} binned` : ''}
              </span>
              <span className="meta">
                Bin what you do not want to sell. Nothing is deleted, binned items can come back.
              </span>
            </div>
          ) : null}

          {live.length === 0 ? (
            <div className="empty">
              <p className="empty__title">Nothing here yet.</p>
              <p className="empty__lede">
                Photograph the space and Clearspace drafts the listings. You just bin what you
                do not want to sell.
              </p>
              <Link className="btn btn--primary btn--lg" href={`/lots/${lot.id}/capture`}>
                Add photos
              </Link>
            </div>
          ) : (
            <InventoryBoard
              lotId={lot.id}
              items={live}
              captureHref={`/lots/${lot.id}/capture`}
              initialCursor={Number(cursor ?? 0)}
            />
          )}

          {/*
            The on-ramp to scan review. It sits below the board rather than in
            the app bar because it is the rescue hatch, not a main path: you
            come here only when Clearspace missed something.
          */}
          {scans.length > 0 ? (
            <section className="panel">
              <div className="panel__head panel__head--wrap">
                <span className="label">Original photos · {scans.length}</span>
                <span className="meta">
                  Clearspace missed something? Open the photo it was in and draw a box around it.
                </span>
              </div>
              <div className="panel__body">
                <div className="thumbrow">
                  {scans.map((scan) => (
                    <Link className="thumbrow__tile" key={scan.id} href={`/scans/${scan.id}`}>
                      {/* A video scan has no blob of its own; its frames carry the pixels. */}
                      {scan.blobKey ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={blobUrl(scan.blobKey)} alt="" loading="lazy" />
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </main>

      {/*
        No action bar on this page at any point. When the board is present it
        brings its own, and two fixed bars stack: the second buries the button
        that moves the user forward. When the lot is empty the dashed panel
        already carries the one action, and a floating bar repeating it is the
        second primary action on a screen entitled to one.
      */}
    </div>
  )
}
