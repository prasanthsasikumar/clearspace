import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { ListingsReview } from '@/components/ListingsReview'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { listItems } from '@/services/items'
import { getEnrichmentProgress } from '@/services/enrichment'
import { requireSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

export default async function ListingsPage({
  params,
}: {
  params: Promise<{ lotId: string }>
}) {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) notFound()

  const [items, progress] = await Promise.all([
    listItems(db, lot.id),
    getEnrichmentProgress(db, lot.id),
  ])

  return (
    <div className="shell">
      <AppBar back={{ href: `/lots/${lot.id}`, label: lot.name }} title="Listings" />
      <main className="page page--barred">
        <ListingsReview
          lotId={lot.id}
          items={items.filter((item) => item.status !== 'discarded')}
          progress={progress}
        />
      </main>
    </div>
  )
}
