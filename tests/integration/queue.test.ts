import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHarness, type Harness } from '../helpers/harness'
import { jobs } from '@/db/schema'
import {
  backoffMs,
  claimNextJob,
  completeJob,
  enqueue,
  failJob,
  getJob,
  reclaimStalledJobs,
} from '@/jobs/queue'
import { registerHandler, runOnce } from '@/jobs/worker'

describe('job queue', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = await createHarness()
  })

  afterEach(async () => {
    await harness.close()
  })

  it('claims the oldest due job and marks it running', async () => {
    const first = await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })
    await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })

    const claimed = await claimNextJob(harness.db)

    expect(claimed!.id).toBe(first.id)
    expect(claimed!.status).toBe('running')
    expect(claimed!.attempts).toBe(1)
  })

  it('will not claim a job scheduled for the future', async () => {
    await enqueue(
      harness.db,
      'detect_objects',
      { scanId: crypto.randomUUID() },
      { runAfter: new Date(Date.now() + 60_000) },
    )
    expect(await claimNextJob(harness.db)).toBeNull()
  })

  it('does not hand the same job to two workers', async () => {
    await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })

    const first = await claimNextJob(harness.db)
    const second = await claimNextJob(harness.db)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('returns a failed job to pending with a delay while attempts remain', async () => {
    const job = await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })
    const claimed = (await claimNextJob(harness.db))!

    await failJob(harness.db, claimed, new Error('model unavailable'))

    const after = await getJob(harness.db, job.id)
    expect(after!.status).toBe('pending')
    expect(after!.lastError).toContain('model unavailable')
    expect(after!.runAfter.getTime()).toBeGreaterThan(Date.now())
  })

  it('gives up once the attempts are exhausted', async () => {
    const job = await enqueue(
      harness.db,
      'detect_objects',
      { scanId: crypto.randomUUID() },
      { maxAttempts: 1 },
    )
    const claimed = (await claimNextJob(harness.db))!

    await failJob(harness.db, claimed, new Error('nope'))

    expect((await getJob(harness.db, job.id))!.status).toBe('failed')
  })

  it('backs off exponentially and then stops growing', () => {
    expect(backoffMs(1)).toBe(2_000)
    expect(backoffMs(2)).toBe(4_000)
    expect(backoffMs(3)).toBe(8_000)
    expect(backoffMs(99)).toBe(60_000)
  })

  it('stores a result on completion', async () => {
    const job = await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })
    await claimNextJob(harness.db)
    await completeJob(harness.db, job.id, { detectionCount: 7 })

    const after = await getJob(harness.db, job.id)
    expect(after!.status).toBe('complete')
    expect(after!.result).toEqual({ detectionCount: 7 })
  })

  it('reclaims a job whose worker died mid-run', async () => {
    const job = await enqueue(harness.db, 'detect_objects', { scanId: crypto.randomUUID() })
    await claimNextJob(harness.db)
    await harness.db
      .update(jobs)
      .set({ lockedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(jobs.id, job.id))

    expect(await reclaimStalledJobs(harness.db)).toBe(1)
    expect((await getJob(harness.db, job.id))!.status).toBe('pending')
  })

  it('fails a job whose type has no handler instead of losing it silently', async () => {
    // Bypass the typed helper — this is the shape a stale enqueue leaves behind.
    const [job] = await harness.db
      .insert(jobs)
      .values({ type: 'retired_job_type', payload: {} })
      .returning()

    await runOnce(harness)

    const after = await getJob(harness.db, job!.id)
    expect(after!.lastError).toContain('No handler registered')
  })

  it('records a handler throw as a failure rather than crashing the worker', async () => {
    registerHandler('exploding_test_job', async () => {
      throw new Error('boom')
    })
    const [job] = await harness.db
      .insert(jobs)
      .values({ type: 'exploding_test_job', payload: {}, maxAttempts: 1 })
      .returning()

    await expect(runOnce(harness)).resolves.not.toBeNull()

    const after = await getJob(harness.db, job!.id)
    expect(after!.status).toBe('failed')
    expect(after!.lastError).toContain('boom')
  })
})
