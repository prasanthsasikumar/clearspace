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

export const GET = route(async (request: NextRequest) => handle(request))
export const POST = route(async (request: NextRequest) => handle(request))

/** A visitor-driven tick starts only a couple of jobs; a scheduler drains. */
const VISITOR_JOB_LIMIT = 2

async function handle(request: NextRequest): Promise<NextResponse> {
  const scheduled = hasSchedulerSecret(request)

  // Each job can spend real money on model calls, so this is never open.
  if (!scheduled && !(await hasSession())) {
    return fail('unauthorized', 'Not authorised.', 401)
  }

  const ctx = getAppContext()
  const deadline = Date.now() + Math.max(5_000, maxDuration * 1_000 - SAFETY_MARGIN_MS)
  const limit = scheduled ? Number.POSITIVE_INFINITY : VISITOR_JOB_LIMIT

  // A process that died mid-job leaves its row locked; nothing else will ever
  // pick it up unless someone reclaims it first.
  const reclaimed = scheduled ? await reclaimStalledJobs(ctx.db) : 0

  let processed = 0
  while (processed < limit && Date.now() < deadline) {
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
