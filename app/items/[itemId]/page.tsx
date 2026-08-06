import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { ItemEditor } from '@/components/ItemEditor'
import { getAppContext } from '@/server/context'
import { getItemDetail } from '@/services/items'
import { getLot } from '@/services/lots'
import { getCurrentUser } from '@/services/user'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const { db } = getAppContext()
  const user = await getCurrentUser(db)

  const detail = await getItemDetail(db, itemId)
  if (!detail) notFound()

  const lot = await getLot(db, user.id, detail.item.lotId)
  if (!lot) notFound()

  return (
    <div className="shell">
      <AppBar back={{ href: `/lots/${lot.id}`, label: lot.name }} title="Item" />
      <main className="page page--barred">
        <ItemEditor
          item={detail.item}
          photos={detail.photos}
          coverage={detail.coverage}
          lotId={lot.id}
          lotName={lot.name}
        />
      </main>
    </div>
  )
}
