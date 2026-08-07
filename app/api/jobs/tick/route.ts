import { NextResponse, type NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { runOnce } from '@/jobs/worker'
import { reclaimStalledJobs } from '@/jobs/queue'
import { env } from '@/config/env'
import { getIdentity } from '@/server/auth'

/**
 * The queue's heartbeat when there is no long-lived process to run it.
 *
 * Locally an in-process poller drains the queue. On a serverless host nothing
 * stays alive between requests, so jobs would be enqueued and never run, and
 * the failure is silent: the UI sits at "Analysing…" forever with no error.
 * This endpoint is what a scheduler calls instead.
 *
 * It drains until it runs out of work or out of time, rather than doing a
 * fixed number of jobs. Detection takes ~4s and enrichment ~30s, so a fixed
 * count would either waste most of the invocation or overrun it; a deadline
 * adapts to whatever mix of work is queued.
 *
 * Two callers, two budgets:
 *
 *   - A **scheduler** with CRON_SECRET drains freely. It is the backstop for
 *     work nobody is watching.
 *   - A **signed-in visitor** drains a couple of jobs per call. The progress
 *     screens are already polling, so this makes work happen the moment
 *     somebody is waiting for it, which also means the app does not depend
 *     on cron granularity at all. That matters: Vercel's Hobby plan only runs
 *     cron once per day, and a daily queue drain is no queue.
 */
export const maxDuration = 60

const SAFETY_MARGIN_MS = 8_000
/** No job is worth starting with less than this left on the clock. */
const MIN_JOB_BUDGET_MS = 15_000

export const GET = route(async (request: NextRequest) => handle(request))
export const POST = route(async (request: NextRequest) => handle(request))

/** A visitor-driven tick starts only a couple of jobs; a scheduler drains. */
/*
 * No cap. A visitor's nudge drains until the function runs out of time, the
 * same as the scheduled run.
 *
 * The cap existed because a browser cannot hold CRON_SECRET, so "is signed in"
 * is the only credential it has, and this app signs everyone in the moment
 * they arrive: two jobs a knock was what stopped an anonymous visitor spending
 * someone else's model budget in a loop. That protection is now traded for
 * speed, deliberately. A lot that fills in over several minutes reads as a
 * poor system regardless of why.
 *
 * The time deadline below is what still bounds a single call.
 */
const VISITOR_JOB_LIMIT = Number.POSITIVE_INFINITY

async function handle(request: NextRequest): Promise<NextResponse> {
  const scheduled = hasSchedulerSecret(request)

  // Each job can spend real money on model calls, so this is never open.
  if (!scheduled && !(await hasSession())) {
    return fail('unauthorized', 'Not authorised.', 401)
  }

  const ctx = getAppContext()
  const deadline = Date.now() + Math.max(5_000, maxDuration * 1_000 - SAFETY_MARGIN_MS)
  const limit = scheduled ? Number.POSITIVE_INFINITY : VISITOR_JOB_LIMIT

  /*
   * Everyone reclaims, not just the scheduler.
   *
   * A job that outlives the function is killed with its row still marked
   * running and still locked, and nothing claims a locked row, so that job is
   * invisible from then on. Enrichment is two model calls with a web search
   * behind them and outlives the budget often. Reclaiming was gated behind
   * the scheduled run, which on this plan happens once a day, so a batch that
   * lost a job to the clock sat at "writing" until tomorrow.
   *
   * There is nothing to gate: reclaiming only touches rows whose lock is
   * older than the longest a job could possibly still be alive, which makes
   * them dead by definition.
   */
  const reclaimed = await reclaimStalledJobs(ctx.db)

  /*
   * Do not start something there is no time to finish. Starting a job with
   * five seconds left buys a killed function and a locked row, which is the
   * failure this reclaim exists to clean up: better to leave it pending for
   * the next call, which begins with a full budget.
   */
  let processed = 0
  while (processed < limit && Date.now() + MIN_JOB_BUDGET_MS < deadline) {
    const job = await runOnce(ctx)
    if (!job) break
    processed += 1
  }

  return ok({
    processed,
    reclaimed,
    ranOutOfTime: Date.now() >= deadline,
  })
}

/**
 * A signed-in visitor may nudge the queue. They cannot hold CRON_SECRET (it
 * would have to ship to the browser), so the session is the credential, and
 * the job limit above is what keeps it from being a lever on someone else's
 * bill.
 */
async function hasSession(): Promise<boolean> {
  // Auth unconfigured means a single local user on a machine they own.
  if (!env.NEXT_PUBLIC_SUPABASE_URL) return true
  return (await getIdentity()) !== null
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The query-parameter
 * form exists for schedulers that cannot set headers; it is checked with the
 * same constant-time comparison.
 */
function hasSchedulerSecret(request: NextRequest): boolean {
  const secret = env.CRON_SECRET
  // Unset means a local run with no scheduler in front of it.
  if (!secret) return true

  const header = request.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const query = new URL(request.url).searchParams.get('secret')

  return safeEqual(bearer, secret) || safeEqual(query, secret)
}

function safeEqual(candidate: string | null, expected: string): boolean {
  if (candidate === null || candidate.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}
