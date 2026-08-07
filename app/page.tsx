import Link from 'next/link'
import { AppBar } from '@/components/AppBar'
import { NewLotButton } from '@/components/NewLotButton'
import { getAppContext } from '@/server/context'
import { listLots } from '@/services/lots'
import { getCurrentUser } from '@/services/user'
import { isDemoMode } from '@/config/env'

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
  const user = await getCurrentUser(db)
  const lots = await listLots(db, user.id)

  return (
    <div className="shell">
      <AppBar action={<NewLotButton />} />

      <main className="page">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <h1>Everything you own, sorted.</h1>
            <p className="lede">
              Photograph a space from wherever you are standing. Sorta works out what is in
              there, matches the same thing across your photos, and writes it up.
            </p>
          </div>

          {isDemoMode ? (
            <p className="notice">
              <span aria-hidden="true">●</span>
              <span>
                Running on recorded detections — no <code>GEMINI_API_KEY</code> is set. Every
                other part of the app is live.
              </span>
            </p>
          ) : null}

          {lots.length === 0 ? (
            <div className="empty">
              <p className="label">No lots yet</p>
              <p className="lede">
                A lot is one space you are clearing out — a unit, a garage, a house.
              </p>
            </div>
          ) : (
            <section className="panel">
              <div className="panel__head">
                <span className="label">Your lots</span>
                <span className="label">{lots.length}</span>
              </div>
              {lots.map((lot) => (
                <div className="rowlink rowlink--actions" key={lot.id}>
                  <span className="label" aria-hidden="true">
                    {KIND_LABELS[lot.kind]?.slice(0, 2) ?? 'LT'}
                  </span>
                  <Link className="linkish stack stack--tight" href={`/lots/${lot.id}`}>
                    <span className="rowlink__title">{lot.name}</span>
                    <span className="meta">
                      {KIND_LABELS[lot.kind] ?? 'Lot'}
                      {lot.locationText ? ` · ${lot.locationText}` : ''} ·{' '}
                      {lot.itemCount === 0
                        ? 'nothing catalogued yet'
                        : `${lot.itemCount} ${lot.itemCount === 1 ? 'item' : 'items'}`}
                    </span>
                  </Link>
                  {lot.actionableCount > 0 ? (
                    <span className="chip chip--attention">{lot.actionableCount} to do</span>
                  ) : (
                    <span />
                  )}
                  {/* Adding photos is the whole product; it should not be two
                      screens deep from the first thing the user sees. */}
                  <Link className="btn btn--sm btn--primary" href={`/lots/${lot.id}/capture`}>
                    Add photos
                  </Link>
                </div>
              ))}
            </section>
          )}

          <footer className="colophon">
            <span>Sorta</span>
            <span>Photos and inventory stay on this machine.</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
