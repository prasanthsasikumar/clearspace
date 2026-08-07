import { NextResponse, type NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { runOnce } from '@/jobs/worker'
import { reclaimStalledJobs } from '@/jobs/queue'
import { env } from '@/config/env'

/**
 * The queue's heartbeat when there is no long-lived process to run it.
 *
 * Locally an in-process poller drains the queue. On a serverless host nothing
 * stays alive between requests, so jobs would be enqueued and never run — and
 * the failure is silent: the UI sits at "Analysing…" forever with no error.
 * This endpoint is what a scheduler calls instead.
 *
 * It drains until it runs out of work or out of time, rather than doing a
 * fixed number of jobs. Detection takes ~4s and enrichment ~30s, so a fixed
 * count would either waste most of the invocation or overrun it; a deadline
 * adapts to whatever mix of work is queued.
 */
export const maxDuration = 60

const SAFETY_MARGIN_MS = 8_000

export const GET = route(async (request: NextRequest) => handle(request))
export const POST = route(async (request: NextRequest) => handle(request))

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    // Each job can spend real money on model calls, so this is never open.
    return fail('unauthorized', 'Not authorised.', 401)
  }

  const ctx = getAppContext()
  const budgetMs = Math.max(5_000, maxDuration * 1_000 - SAFETY_MARGIN_MS)
  const deadline = Date.now() + budgetMs

  // A process that died mid-job leaves its row locked; nothing else will ever
  // pick it up unless someone reclaims it first.
  const reclaimed = await reclaimStalledJobs(ctx.db)

  let processed = 0
  let ranOutOfTime = false

  while (Date.now() < deadline) {
    const job = await runOnce(ctx)
    if (!job) break
    processed += 1
  }
  if (Date.now() >= deadline) ranOutOfTime = true

  return ok({ processed, reclaimed, ranOutOfTime })
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The query-parameter
 * form exists for schedulers that cannot set headers; it is checked with the
 * same constant-time comparison.
 */
function isAuthorized(request: NextRequest): boolean {
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
