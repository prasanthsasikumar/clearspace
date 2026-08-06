import type { Database } from '@/db/client'
import type { BlobStore } from '@/storage'
import type { VisionProvider } from '@/ai/vision-provider'
import type { Job } from '@/db/schema'
import { claimNextJob, completeJob, failJob, reclaimStalledJobs } from './queue'

export interface JobContext {
  db: Database
  blobs: BlobStore
  vision: VisionProvider
}

export type JobHandler = (ctx: JobContext, job: Job) => Promise<unknown>

const handlers = new Map<string, JobHandler>()

export function registerHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler)
}

export function getHandler(type: string): JobHandler | undefined {
  return handlers.get(type)
}

/**
 * Claims and runs a single job, returning it if one was available.
 *
 * Tests drive the queue through this rather than the timer, so a test can
 * assert "upload, drain, expect detections" with no sleeping and no flake.
 */
export async function runOnce(ctx: JobContext): Promise<Job | null> {
  const job = await claimNextJob(ctx.db)
  if (!job) return null

  const handler = handlers.get(job.type)
  if (!handler) {
    await failJob(ctx.db, job, new Error(`No handler registered for job type "${job.type}"`))
    return job
  }

  try {
    const result = await handler(ctx, job)
    await completeJob(ctx.db, job.id, result)
  } catch (error) {
    await failJob(ctx.db, job, error)
  }
  return job
}

/** Drains the queue. Bounded so a handler that enqueues work cannot spin. */
export async function drain(ctx: JobContext, maxJobs = 100): Promise<number> {
  let processed = 0
  while (processed < maxJobs) {
    const job = await runOnce(ctx)
    if (!job) break
    processed += 1
  }
  return processed
}

const globalForWorker = globalThis as unknown as { __sortaWorker?: NodeJS.Timeout }

/**
 * Starts the in-process poller. Idempotent across Next.js hot reloads, which
 * would otherwise stack a new timer on every file save.
 */
export function startWorker(ctx: JobContext, intervalMs = 750): void {
  if (globalForWorker.__sortaWorker) return

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await reclaimStalledJobs(ctx.db)
      await drain(ctx, 5)
    } catch (error) {
      console.error('[worker] tick failed', error)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), intervalMs)
  // Never hold the process open for the sake of an idle poller.
  timer.unref?.()
  globalForWorker.__sortaWorker = timer
}

export function stopWorker(): void {
  if (!globalForWorker.__sortaWorker) return
  clearInterval(globalForWorker.__sortaWorker)
  globalForWorker.__sortaWorker = undefined
}
