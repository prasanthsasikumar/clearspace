import Link from 'next/link'
import { AppBar } from '@/components/AppBar'
import { NewLotButton } from '@/components/NewLotButton'
import { AccountBadge } from '@/components/AccountBadge'
import { isAuthEnabled } from '@/config/env'
import { getAppContext } from '@/server/context'
import { listLots } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, string> = {
  storage_unit: 'Storage unit',
  garage: 'Garage',
  home: 'Home',
  estate: 'Estate sale',
  office: 'Office',
  other: 'Lot',
}

export default async function LotsPage() {
  const { db } = getAppContext()
  const user = await requireSessionUser(db)
  const lots = await listLots(db, user.id)

  return (
    <div className="shell">
      <AppBar
        account={
          isAuthEnabled ? (
            <AccountBadge
              email={user.email}
              isAnonymous={user.isAnonymous}
              hasWork={lots.length > 0}
            />
          ) : null
        }
      />

      <main className="page">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <h1>List everything in minutes, not weekends.</h1>
            <p className="lede lede--wide">
              Photograph the space. AI splits it into items, writes each listing, and gets them
              ready for Facebook Marketplace and eBay.
            </p>
          </div>

          {/*
            A list, not a dashboard. Nobody has a hundred lots, so width buys a
            wider row (kind, location and counts on one line) rather than
            columns that would have to be invented to fill it.
          */}
          {lots.length === 0 ? (
            <div className="empty">
              <p className="empty__title">No lots yet.</p>
              <p className="empty__lede">
                A lot is one space you are clearing: a storage unit, a garage, a whole house.
                Make one, photograph it, and Clearspace writes the listings.
              </p>
              <NewLotButton size="lg" />
            </div>
          ) : (
            <section className="panel">
              <div className="panel__head">
                <span className="label">Lots · {lots.length}</span>
                <NewLotButton />
              </div>
              {lots.map((lot) => (
                <Link className="rowlink" key={lot.id} href={`/lots/${lot.id}`}>
                  <span className="rowlink__lead">
                    <span className="rowlink__title">{lot.name}</span>
                    <span className="rowlink__meta">
                      {KIND_LABELS[lot.kind] ?? 'Lot'}
                      {lot.locationText ? ` · ${lot.locationText}` : ''}
                    </span>
                  </span>
                  <span className="rowlink__count">
                    {lot.itemCount === 0
                      ? 'nothing yet'
                      : `${lot.itemCount} ${lot.itemCount === 1 ? 'item' : 'items'}`}
                  </span>
                  {lot.actionableCount > 0 ? (
                    <span className="chip chip--todo">{lot.actionableCount} to do</span>
                  ) : null}
                  <span className="rowlink__chev" aria-hidden="true">
                    ›
                  </span>
                </Link>
              ))}
            </section>
          )}

          <footer className="colophon">
            <span>Clearspace · list everything in minutes, not weekends.</span>
            <span>
              {user.isAnonymous
                ? 'Photos stay on this device until you upload a batch. Sign in to keep your work.'
                : 'Photos stay on this device until you upload a batch.'}
            </span>
          </footer>
        </div>
      </main>
    </div>
  )
}
