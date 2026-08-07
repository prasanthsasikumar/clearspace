import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { BatchProgress } from '@/components/BatchProgress'
import { getAppContext } from '@/server/context'
import { getBatchProgress } from '@/services/batches'
import { getLot } from '@/services/lots'
import { requireSessionUser } from '@/server/auth'

export const dynamic = 'force-dynamic'

export default async function BatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  const { batchId } = await params
  const { db } = getAppContext()
  const user = await requireSessionUser(db)

  const progress = await getBatchProgress(db, batchId)
  if (!progress) notFound()

  const lot = await getLot(db, user.id, progress.lotId)
  if (!lot) notFound()

  return (
    <div className="shell">
      <AppBar back={{ href: `/lots/${lot.id}`, label: lot.name }} title="Sorting" />
      <main className="page page--barred">
        <BatchProgress batchId={batchId} initial={progress} />
      </main>
    </div>
  )
}
