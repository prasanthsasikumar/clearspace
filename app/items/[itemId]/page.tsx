import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { ItemEditor } from '@/components/ItemEditor'
import { ItemRail } from '@/components/ItemRail'
import { getAppContext } from '@/server/context'
import { getItemDetail, listItems } from '@/services/items'
import { getEnrichment } from '@/services/enrichment'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>
  searchParams: Promise<{ cursor?: string }>
}) {
  const { itemId } = await params
  const { cursor } = await searchParams
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const detail = await getItemDetail(db, itemId)
  if (!detail) notFound()

  const lot = await getLot(db, user.id, detail.item.lotId)
  if (!lot) notFound()

  const enrichment = await getEnrichment(db, detail.item.id)

  /*
   * The rail's contents. Binned items are left out because the rail is a list
   * of things you are still selling, and walking J through something you
   * already threw away is a step backwards.
   */
  const siblings = (await listItems(db, lot.id)).filter((i) => i.status !== 'discarded')
  const index = siblings.findIndex((i) => i.id === detail.item.id)
  const position = Number(cursor ?? index)

  return (
    <div className="shell">
      {/* The rail carries its own back link, so the app bar would be saying
          the same thing twice at desktop widths. */}
      <AppBar
        back={{ href: `/lots/${lot.id}?cursor=${position}`, label: lot.name }}
        title="Item"
      />
      <div className="split">
        <aside className="split__rail" aria-label="Listings in this lot">
          <ItemRail
            items={siblings}
            currentId={detail.item.id}
            lotId={lot.id}
            lotName={lot.name}
            cursor={Number.isFinite(position) ? position : 0}
          />
        </aside>

        <main className="split__main page page--barred">
          <div className="detailhead">
            <span className="label">
              {lot.name} · item {index + 1} of {siblings.length}
            </span>
          </div>
          <ItemEditor
            item={detail.item}
            photos={detail.photos}
            coverage={detail.coverage}
            listing={enrichment.listing}
            valuation={enrichment.valuation}
            identification={enrichment.identification}
            lotId={lot.id}
            lotName={lot.name}
          />
        </main>
      </div>
    </div>
  )
}
