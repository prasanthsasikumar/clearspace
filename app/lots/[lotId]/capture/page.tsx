import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { BulkCapture } from '@/components/BulkCapture'
import { getAppContext } from '@/server/context'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

export default async function CapturePage({
  params,
}: {
  params: Promise<{ lotId: string }>
}) {
  const { lotId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const lot = await getLot(db, user.id, lotId)
  if (!lot) notFound()

  return (
    <div className="shell">
      <AppBar back={{ href: `/lots/${lot.id}`, label: lot.name }} title="Add photos" />
      <main className="page page--barred">
        <BulkCapture lotId={lot.id} />
      </main>
    </div>
  )
}
