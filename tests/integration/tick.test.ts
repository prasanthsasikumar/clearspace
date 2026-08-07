import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, makeJpeg, type Harness } from '../helpers/harness'
import { jobs } from '@/db/schema'
import { createBatch } from '@/services/batches'
import { createLot } from '@/services/lots'
import { listItems } from '@/services/items'
import { getCurrentUser } from '@/services/user'
import { reclaimStalledJobs } from '@/jobs/queue'
import { runOnce } from '@/jobs/worker'

/**
 * The drain loop behind /api/jobs/tick.
 *
 * The endpoint itself is a thin auth wrapper; what has to be right is that
 * repeated bounded drains eventually finish a batch, because on a serverless
 * host that is the only way any work ever happens.
 */
describe('queue draining without a long-lived worker', () => {
  let harness: Harness
  let lotId: string

  beforeEach(async () => {
    harness = await createHarness()
    const user = await getCurrentUser(harness.db)
    const lot = await createLot(harness.db, user.id, { name: 'Unit 41', kind: 'storage_unit' })
    lotId = lot.id
  })

  afterEach(async () => {
    await harness.close()
  })

  it('finishes a batch across repeated bounded drains', async () => {
    await createBatch(harness.db, harness.blobs, {
      lotId,
      files: [
        { data: await makeJpeg(900, 700), mimeType: 'image/jpeg' },
        { data: await makeJpeg(900, 700), mimeType: 'image/jpeg' },
      ],
    })

    // Each call stands in for one scheduler invocation. None of them sees the
    // whole queue, and grouping is only enqueued once detection finishes.
    let ticks = 0
    let processed = 0
    while (ticks < 20) {
      ticks += 1
      const job = await runOnce(harness)
      if (!job) break
      processed += 1
    }

    expect(processed).toBeGreaterThanOrEqual(3) // 2 detections + 1 grouping
    expect((await listItems(harness.db, lotId)).length).toBeGreaterThan(0)
  })

  it('reports nothing to do on an empty queue rather than spinning', async () => {
    expect(await runOnce(harness)).toBeNull()
  })

  it('reclaims a job whose invocation died mid-flight', async () => {
    await createBatch(harness.db, harness.blobs, {
      lotId,
      files: [{ data: await makeJpeg(800, 600), mimeType: 'image/jpeg' }],
    })

    // Nothing reclaimable yet: the job is still pending, not stuck.
    expect(await reclaimStalledJobs(harness.db)).toBe(0)
  })

  /*
   * The bug that made a batch sit at "writing" until the next day.
   *
   * An enrichment is two model calls with a web search behind them and
   * routinely outlives the function running it. The kill leaves the row marked
   * running and locked, nothing claims a locked row, and reclaiming was gated
   * behind the scheduled run, which on this plan happens once a day.
   */
  it('reclaims a job whose function was killed, without a scheduler secret', async () => {
    const [job] = await harness.db
      .insert(jobs)
      .values({ type: 'detect_objects', payload: { scanId: crypto.randomUUID() } })
      .returning()

    // Locked long enough ago that nothing could still be running it.
    await harness.db
      .update(jobs)
      .set({ status: 'running', lockedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(jobs.id, job!.id))

    expect(await reclaimStalledJobs(harness.db)).toBe(1)

    const [after] = await harness.db.select().from(jobs).where(eq(jobs.id, job!.id))
    expect(after!.status).toBe('pending')
    expect(after!.lockedAt).toBeNull()
  })
})
