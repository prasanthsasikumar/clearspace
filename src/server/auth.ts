import { cookies } from 'next/headers'
import { isAuthEnabled } from '@/config/env'
import { createServerAuthClient, toIdentity, type AuthIdentity } from '@/auth/supabase'
import type { Database } from '@/db/client'
import { getOrCreateUser, getLocalUser, type AppUser } from '@/services/user'
import { redirect } from 'next/navigation'

/**
 * Resolves who is asking.
 *
 * Three cases, in order:
 *
 *   1. Auth is not configured → one implicit local user. A fresh clone stays
 *      fully usable before anyone signs up for anything.
 *   2. A Supabase session exists → that user, anonymous or not.
 *   3. No session → null. The caller decides whether to sign the visitor in
 *      anonymously; a server component cannot, because signing in writes
 *      cookies and React server rendering may not.
 */
export async function getSessionUser(db: Database): Promise<AppUser | null> {
  if (!isAuthEnabled) return getLocalUser(db)

  const identity = await getIdentity()
  if (!identity) return null

  return getOrCreateUser(db, identity)
}

export async function getIdentity(): Promise<AuthIdentity | null> {
  if (!isAuthEnabled) return null

  const store = await cookies()
  const supabase = createServerAuthClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    // Server components cannot set cookies. Refreshing the session is the
    // middleware's job; here a failed write is expected and ignored.
    setAll: (toSet) => {
      try {
        for (const c of toSet) store.set(c.name, c.value, c.options)
      } catch {
        /* read-only rendering context */
      }
    },
  })

  // getUser revalidates against Supabase rather than trusting the cookie —
  // getSession would hand back whatever the browser claimed.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null

  return toIdentity(data.user)
}


/**
 * The session user, or a redirect to sign in.
 *
 * Middleware signs first-time visitors in anonymously before anything renders,
 * so reaching this without a user means either that anonymous sign-ins are
 * turned off in the project or the session expired. Both are recoverable by
 * signing in, which is where this sends them rather than showing an error for
 * a condition the visitor did not cause.
 */
export async function requireSessionUser(db: Database): Promise<AppUser> {
  const user = await getSessionUser(db)
  if (!user) redirect('/signin')
  return user
}
