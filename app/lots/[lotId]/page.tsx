import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { StatusChip } from '@/components/StatusChip'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { listItems } from '@/services/items'
import { listScansForLot } from '@/services/scans'
import { getCurrentUser } from '@/services/user'
import { statusOrder } from '@/domain/item-status'
import { blobUrl } from '@/lib/client/api'
import type { ItemStatus } from '@/db/schema'

export const dynamic = 'force-dynamic'

export default async function LotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await getCurrentUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) notFound()

  const [items, scans] = await Promise.all([listItems(db, lot.id), listScansForLot(db, lot.id)])
  const live = items.filter((item) => item.status !== 'discarded')

  // Grouped by what the seller still has to do, most urgent first — the same
  // vocabulary the status chips use, so the page reads as one list, not two.
  const groups = statusOrder
    .map((status) => ({ status, items: live.filter((item) => item.status === status) }))
    .filter((group) => group.items.length > 0)

  const latestScan = scans.at(-1)

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
                : `${live.length} ${live.length === 1 ? 'item' : 'items'} catalogued`}
              {lot.locationText ? ` · ${lot.locationText}` : ''}
            </p>
          </div>

          {latestScan && latestScan.status !== 'complete' ? (
            <Link className="notice notice--accent" href={`/scans/${latestScan.id}`}>
              <span className="working__dot" aria-hidden="true" />
              <span>A scan is still being analysed. Open it →</span>
            </Link>
          ) : null}

          {live.length === 0 ? (
            <div className="empty">
              <p className="label">Empty lot</p>
              <p className="lede">
                Take one wide photo of a wall. Sorta will box up everything sellable in it.
              </p>
              <Link className="btn btn--primary" href={`/lots/${lot.id}/capture`}>
                Scan a room
              </Link>
            </div>
          ) : (
            groups.map((group) => (
              <section className="panel" key={group.status}>
                <div className="panel__head">
                  <span className="label">{headingFor(group.status)}</span>
                  <span className="label">{group.items.length}</span>
                </div>
                {group.items.map((item) => (
                  <Link className="rowlink" key={item.id} href={`/items/${item.id}`}>
                    {item.primaryPhotoKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className="thumb"
                        src={blobUrl(item.primaryPhotoKey)}
                        alt=""
                        width={48}
                        height={48}
                        loading="lazy"
                      />
                    ) : (
                      <span className="thumb" aria-hidden="true" />
                    )}
                    <span className="stack stack--tight">
                      <span className="rowlink__title">{item.title}</span>
                      <span className="meta">
                        {[item.brand, item.model].filter(Boolean).join(' ') ||
                          describePhotos(item.photoCount)}
                      </span>
                    </span>
                    <StatusChip status={item.status} />
                  </Link>
                ))}
              </section>
            ))
          )}

          {scans.length > 0 ? (
            <section className="panel">
              <div className="panel__head">
                <span className="label">Scans</span>
                <span className="label">{scans.length}</span>
              </div>
              {scans.map((scan) => (
                <Link className="rowlink" key={scan.id} href={`/scans/${scan.id}`}>
                  <span className="label" aria-hidden="true">
                    {scan.kind === 'video' ? 'VID' : 'IMG'}
                  </span>
                  <span className="stack stack--tight">
                    <span className="rowlink__title">{describeScan(scan.kind)}</span>
                    <span className="meta">
                      {new Date(scan.createdAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </span>
                  {scan.status === 'complete' ? (
                    <span className="rowlink__chev" aria-hidden="true">
                      ›
                    </span>
                  ) : (
                    <span className="chip chip--attention">{scan.status}</span>
                  )}
                </Link>
              ))}
            </section>
          ) : null}
        </div>
      </main>

      <aside className="actionbar">
        <span className="actionbar__note">
          {live.length === 0 ? 'Start with one wide shot.' : 'Scan another wall or shelf.'}
        </span>
        <Link className="btn btn--primary" href={`/lots/${lot.id}/capture`}>
          Capture
        </Link>
      </aside>
    </div>
  )
}

function headingFor(status: ItemStatus): string {
  switch (status) {
    case 'photos_needed':
      return 'Photos needed'
    case 'needs_confirmation':
      return 'Needs confirmation'
    case 'ai_identified':
      return 'AI identified'
    case 'confirmed':
      return 'Ready to list'
    case 'listed':
      return 'Listed'
    case 'sold':
      return 'Sold'
    default:
      return 'Detected'
  }
}

function describePhotos(count: number): string {
  if (count === 0) return 'No photos yet'
  return count === 1 ? '1 photo' : `${count} photos`
}

function describeScan(kind: string): string {
  if (kind === 'video') return 'Video walkthrough'
  if (kind === 'photo') return 'Photo'
  return 'Room scan'
}
