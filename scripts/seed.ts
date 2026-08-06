import sharp from 'sharp'
import fixture from '../src/ai/fixtures/storage-locker.json'
import { env } from '../src/config/env'
import { getDb } from '../src/db/client'
import { applyMigrations } from '../src/db/migrate'
import { registerJobHandlers } from '../src/jobs/handlers'
import { drain } from '../src/jobs/worker'
import { getObjectMatcher, getVisionProvider } from '../src/ai'
import { getBlobStore } from '../src/storage'
import { createLot, listLots } from '../src/services/lots'
import { getCurrentUser } from '../src/services/user'
import { createBatch, getBatchProgress } from '../src/services/batches'

const WIDTH = 1400
const HEIGHT = 1050

/**
 * Draws the scene that demo mode's recorded detections describe.
 *
 * This is deliberately a diagram, not a fake photograph: the seed exists so a
 * fresh clone has something to tap, and shipping an invented photo of someone's
 * garage would misrepresent what the app produces. The rectangles sit exactly
 * where the recorded boxes say they do, so the overlay lines up with reality.
 */
function sceneSvg(pass = 0): string {
  const objects = fixture.objects.filter((o) => o.sellable)
  // Each pass is nudged, as a second walk past the same shelf would be.
  const jitter = pass * 14

  const shapes = objects
    .map((object) => {
      const [ymin, xmin, ymax, xmax] = object.box_2d as [number, number, number, number]
      const x = (xmin / 1000) * WIDTH + jitter
      const y = (ymin / 1000) * HEIGHT - jitter / 2
      const w = ((xmax - xmin) / 1000) * WIDTH
      const h = ((ymax - ymin) / 1000) * HEIGHT
      const fontSize = Math.max(13, Math.min(22, w / 12))

      return `
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"
              fill="#2f3742" stroke="#59667a" stroke-width="2" />
        <text x="${x + 10}" y="${y + fontSize + 8}" font-family="monospace"
              font-size="${fontSize}" fill="#c8d2e2">${escapeXml(object.label)}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <rect width="100%" height="100%" fill="#1b2029" />
    <rect y="${HEIGHT * 0.86}" width="100%" height="${HEIGHT * 0.14}" fill="#242b36" />
    <text x="24" y="40" font-family="monospace" font-size="20" fill="#5d6a7e">
      SORTA — DEMO SCENE ${pass + 1} (not a photograph)
    </text>
    ${shapes}
  </svg>`
}

function escapeXml(value: string): string {
  return value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)
}

async function main() {
  const db = getDb()
  await applyMigrations(db, env.DATABASE_URL ? 'postgres' : 'pglite')
  registerJobHandlers()

  const blobs = getBlobStore()
  const vision = getVisionProvider()
  const matcher = getObjectMatcher()
  const user = await getCurrentUser(db)

  const existing = await listLots(db, user.id)
  if (existing.some((lot) => lot.name === 'Storage Unit #23')) {
    console.log('Demo lot already exists — nothing to do.')
    process.exit(0)
  }

  const lot = await createLot(db, user.id, {
    name: 'Storage Unit #23',
    kind: 'storage_unit',
    locationText: 'Bay 12, Fremont',
  })

  // Three passes at the same space — the thing the bulk loop exists to handle.
  const files = []
  for (let pass = 0; pass < 3; pass += 1) {
    files.push({
      data: await sharp(Buffer.from(sceneSvg(pass))).jpeg({ quality: 90 }).toBuffer(),
      mimeType: 'image/jpeg',
    })
  }

  const batch = await createBatch(db, blobs, { lotId: lot.id, files })

  console.log(
    `Detecting with "${vision.name}" and matching with "${matcher.name}" across ${files.length} photos…`,
  )
  await drain({ db, blobs, vision, matcher }, 50)

  const progress = await getBatchProgress(db, batch.batchId)
  console.log(
    `Seeded "${lot.name}": ${progress?.detectionCount ?? 0} detections across ` +
      `${progress?.photoCount ?? 0} photos, grouped into ${progress?.itemCount ?? 0} listings ` +
      `(${progress?.multiViewItems ?? 0} with several views).\n` +
      `Open http://localhost:3300/lots/${lot.id}`,
  )
  process.exit(0)
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
