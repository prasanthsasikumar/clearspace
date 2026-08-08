import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerAuthClient, toIdentity } from '@/auth/supabase'
import { isAuthEnabled } from '@/config/env'
import { CLAIM_COOKIE, readClaim } from '@/server/claim'
import { getAppContext } from '@/server/context'
import { getOrCreateUser, transferAnonymousWork } from '@/services/user'

/** Provider codes are echoed back to the user, so only known-shaped ones pass. */
const SAFE_CODE = /^[a-z_]{1,64}$/

function signinUrl(origin: string, error: string, next: string): URL {
  const target = new URL('/signin', origin)
  target.searchParams.set('error', error)
  if (next !== '/lots') target.searchParams.set('next', next)
  return target
}

/**
 * Where Google and the email magic link land.
 *
 * Exchanges the one-time code for a session and sends the visitor back where
 * they were. Because the anonymous account is upgraded in place rather than
 * replaced, whatever they had already photographed is simply still there.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  // Only same-origin paths, so a crafted link cannot bounce someone off-site.
  // The rejection falls back to the app rather than to `/`, which is now the
  // marketing page: someone who has just proved who they are should land on
  // their lots, not on the pitch that sold them the thing.
  const next = url.searchParams.get('next') ?? '/lots'
  const destination = next.startsWith('/') ? next : '/lots'

  /*
   * A provider that refuses returns here with `error_code` and no `code` at
   * all. Reading only `code` reported that as a missing one, and the user was
   * told their sign-in link was incomplete: untrue, and impossible to act on.
   * The refusal itself is the useful thing, so it is carried through.
   */
  const refusal = url.searchParams.get('error_code') ?? url.searchParams.get('error')
  if (refusal) {
    return NextResponse.redirect(
      signinUrl(url.origin, SAFE_CODE.test(refusal) ? refusal : 'provider_error', destination),
    )
  }

  if (!isAuthEnabled || !code) {
    return NextResponse.redirect(signinUrl(url.origin, 'missing_code', destination))
  }

  const store = await cookies()
  const supabase = createServerAuthClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (toSet) => {
      for (const c of toSet) store.set(c.name, c.value, c.options)
    },
  })

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(signinUrl(url.origin, 'exchange_failed', destination))
  }

  /*
   * Spend the claim ticket, if there is one.
   *
   * Signing in is always a plain sign-in now, never an upgrade in place, so
   * the account someone lands on is whichever one owns the identity. That is
   * what makes signing in work every time, and it is also what would strand a
   * lot photographed five minutes ago on the anonymous account behind it. The
   * transfer is the other half of that trade, and it runs before the redirect
   * so the board is already right when the page loads.
   *
   * A failure here must not cost the user the sign-in they just completed, so
   * it is logged and swallowed: worst case the work stays where it was and the
   * ticket expires on its own.
   */
  const claimed = readClaim(store.get(CLAIM_COOKIE)?.value)
  store.delete(CLAIM_COOKIE)

  const signedInId = data.user?.id
  if (claimed && signedInId && claimed !== signedInId) {
    try {
      const { db } = getAppContext()
      const identity = toIdentity(data.user!)
      const target = await getOrCreateUser(db, identity)
      await transferAnonymousWork(db, claimed, target.id)
    } catch (cause) {
      console.error('[auth] could not move anonymous work', cause)
    }
  }

  return NextResponse.redirect(new URL(destination, url.origin))
}
