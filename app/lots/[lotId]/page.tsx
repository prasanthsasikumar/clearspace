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

export const dynamic = 'force-dynamic'

export default async function LotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params
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
      <AppBar back={{ href: '/', label: 'Lots' }} title={lot.name} />

      <main className="page page--barred">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <h1>{lot.name}</h1>
            <p className="meta">
              {live.length === 0
                ? 'Nothing catalogued yet.'
                : `${live.length} ${live.length === 1 ? 'listing' : 'listings'}`}
              {binned > 0 ? ` · ${binned} binned` : ''}
              {lot.locationText ? ` · ${lot.locationText}` : ''}
            </p>
          </div>

          {working ? (
            <Link className="notice notice--accent" href={`/batches/${batch.batchId}`}>
              <span className="working__dot" aria-hidden="true" />
              <span>
                Still sorting {batch.photoCount} photos — {batch.analysedCount} looked at. Watch
                it →
              </span>
            </Link>
          ) : null}

          {live.length === 0 ? (
            <div className="empty">
              <p className="label">Empty lot</p>
              <p className="lede">
                Walk around the space taking photos of everything. Clearspace turns them into
                listings.
              </p>
              <Link className="btn btn--primary" href={`/lots/${lot.id}/capture`}>
                Photograph the space
              </Link>
            </div>
          ) : (
            <InventoryBoard lotId={lot.id} items={live} />
          )}

          {scans.length > 0 ? (
            <section className="panel">
              <div className="panel__head">
                <span className="label">Original photos</span>
                <span className="label">{scans.length}</span>
              </div>
              <div className="panel__body">
                <p className="meta">
                  Clearspace missed something? Open the photo it was in and draw a box around it.
                </p>
              </div>
              {scans.slice(-8).reverse().map((scan) => (
                <Link className="rowlink" key={scan.id} href={`/scans/${scan.id}`}>
                  <span className="label" aria-hidden="true">
                    IMG
                  </span>
                  <span className="stack stack--tight">
                    <span className="rowlink__title">
                      {new Date(scan.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span className="meta">{scan.status}</span>
                  </span>
                  <span className="rowlink__chev" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </main>

      <aside className="actionbar">
        <span className="actionbar__note">
          {live.length === 0 ? 'Photograph everything at once.' : 'Shot another wall?'}
        </span>
        <Link className="btn btn--primary" href={`/lots/${lot.id}/capture`}>
          Add photos
        </Link>
      </aside>
    </div>
  )
}
