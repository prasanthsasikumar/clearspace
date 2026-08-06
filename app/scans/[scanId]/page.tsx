import { notFound } from 'next/navigation'
import { AppBar } from '@/components/AppBar'
import { DetectionReview } from '@/components/DetectionReview'
import { getAppContext } from '@/server/context'
import { getScanDetail } from '@/services/scans'
import { getLot } from '@/services/lots'
import { getCurrentUser } from '@/services/user'

export const dynamic = 'force-dynamic'

export default async function ScanPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params
  const { db } = getAppContext()
  const user = await getCurrentUser(db)

  const detail = await getScanDetail(db, scanId)
  if (!detail) notFound()

  const lot = await getLot(db, user.id, detail.scan.lotId)
  if (!lot) notFound()

  return (
    <div className="shell">
      <AppBar back={{ href: `/lots/${lot.id}`, label: lot.name }} title="Review" />
      <main className="page page--barred">
        <DetectionReview
          lotId={lot.id}
          scan={detail.scan}
          frames={detail.frames}
          detections={detail.detections}
        />
      </main>
    </div>
  )
}
