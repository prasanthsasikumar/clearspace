import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getAppContext } from '@/server/context'
import { requireSessionUser } from '@/server/auth'
import { CLAIM_COOKIE, issueClaim } from '@/server/claim'
import { isAuthEnabled } from '@/config/env'

/**
 * Issues the claim ticket, immediately before the browser leaves for Google.
 *
 * It has to happen here rather than in the callback, because by the time the
 * callback runs the anonymous session is gone: the cookie has been replaced by
 * the one for the account just signed in to, and nothing left on the request
 * remembers who the visitor used to be. This is the last moment the server can
 * still see both halves.
 *
 * Only an anonymous session gets one. A signed-in user asking to hand their
 * work to whoever authenticates next is not a thing this should be able to
 * express.
 */
export async function POST() {
  if (!isAuthEnabled) return NextResponse.json({ ticketed: false })

  const { db } = getAppContext()
  const user = await requireSessionUser(db)
  if (!user.isAnonymous) return NextResponse.json({ ticketed: false })

  const ticket = issueClaim(user.id)
  if (!ticket) return NextResponse.json({ ticketed: false })

  const store = await cookies()
  store.set(CLAIM_COOKIE, ticket, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 15 * 60,
  })

  return NextResponse.json({ ticketed: true })
}
