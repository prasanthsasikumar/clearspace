import { and, asc, eq, lte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { jobs, type Job } from '@/db/schema'

/**
 * A Postgres-backed work queue.
 *
 * Object detection on a full storage-locker photo takes 10-30 seconds, which
 * cannot live inside a request handler. A table plus a poller needs no Redis,
 * survives a process restart, and lifts to a standalone worker later without
 * changing a single call site.
 */
export type JobType =
  | 'detect_objects'
  | 'assess_photo'
  | 'group_objects'
  | 'enrich_item'

export interface JobPayloads {
  detect_objects: { scanId: string; frameId?: string; batchId?: string }
  assess_photo: { photoId: string }
  group_objects: { batchId: string; lotId: string }
  enrich_item: { itemId: string }
}

export interface EnqueueOptions {
  maxAttempts?: number
  runAfter?: Date
}

export async function enqueue<T extends JobType>(
  db: Database,
  type: T,
  payload: JobPayloads[T],
  options: EnqueueOptions = {},
): Promise<Job> {
  const [job] = await db
    .insert(jobs)
    .values({
      type,
      payload,
      maxAttempts: options.maxAttempts ?? 3,
      runAfter: options.runAfter ?? new Date(),
    })
    .returning()

  if (!job) throw new Error(`Failed to enqueue job of type ${type}`)
  return job
}

/**
 * Atomically takes the next due job.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes it safe to run more than one poller;
 * two workers racing for the same row will never both win it. PGlite is
 * single-process today, so this costs nothing now and is the difference
 * between working and not once a real worker fleet exists.
 */
export async function claimNextJob(db: Database): Promise<Job | null> {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.runAfter, new Date())))
      .orderBy(asc(jobs.runAfter), asc(jobs.createdAt))
      .limit(1)
      .for('update', { skipLocked: true })

    if (!candidate) return null

    const [claimed] = await tx
      .update(jobs)
      .set({
        status: 'running',
        lockedAt: new Date(),
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, candidate.id))
      .returning()

    return claimed ?? null
  })
}

export async function completeJob(
  db: Database,
  jobId: string,
  result?: unknown,
): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: 'complete',
      lockedAt: null,
      lastError: null,
      result: result === undefined ? null : result,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
}

/** Exponential backoff, capped so a poisoned job cannot park itself for hours. */
export function backoffMs(attempts: number): number {
  return Math.min(2_000 * 2 ** Math.max(attempts - 1, 0), 60_000)
}

/**
 * Records a failure. The job returns to `pending` with a delay while attempts
 * remain, and lands in `failed` once exhausted so the UI can surface it rather
 * than showing an eternal spinner.
 */
export async function failJob(
  db: Database,
  job: Job,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const exhausted = job.attempts >= job.maxAttempts

  await db
    .update(jobs)
    .set({
      status: exhausted ? 'failed' : 'pending',
      lockedAt: null,
      lastError: message.slice(0, 2000),
      runAfter: exhausted ? job.runAfter : new Date(Date.now() + backoffMs(job.attempts)),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id))
}

export async function getJob(db: Database, jobId: string): Promise<Job | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
  return job ?? null
}

/**
 * Returns jobs stuck in `running` past a deadline to `pending`. A process that
 * dies mid-job would otherwise leave the row locked forever.
 */
export async function reclaimStalledJobs(
  db: Database,
  staleAfterMs = 5 * 60_000,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs)
  const reclaimed = await db
    .update(jobs)
    .set({ status: 'pending', lockedAt: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, 'running'), lte(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id })
  return reclaimed.length
}
