import type { NextRequest } from 'next/server'
import { fail, ok, route } from '@/server/api'
import { getAppContext } from '@/server/context'
import { getJob } from '@/jobs/queue'

type Params = { params: Promise<{ jobId: string }> }

export const GET = route(async (_request: NextRequest, { params }: Params) => {
  const { jobId } = await params
  const { db } = getAppContext()

  const job = await getJob(db, jobId)
  if (!job) return fail('not_found', 'That job no longer exists.', 404)

  return ok({
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    // The raw error is for the log; the client gets something it can act on.
    error: job.status === 'failed' ? 'Analysis failed. Try that photo again.' : null,
    result: job.result,
  })
})
