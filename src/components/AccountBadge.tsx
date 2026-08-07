'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserAuthClient } from '@/auth/browser'

/**
 * Who you are, in the app bar.
 *
 * "Save your work" is only honest once there is work. On an empty account it
 * names a benefit the visitor cannot yet feel and reads as a nag, so until
 * they have made something it is just a quiet way in. The moment they have a
 * lot, the offer becomes real and earns the primary style.
 */
export function AccountBadge({
  email,
  isAnonymous,
  hasWork = false,
}: {
  email: string | null
  isAnonymous: boolean
  /** True once the visitor has something that signing in would preserve. */
  hasWork?: boolean
}) {
  const router = useRouter()

  if (isAnonymous) {
    return hasWork ? (
      <Link className="btn btn--sm btn--primary" href="/signin">
        Save your work
      </Link>
    ) : (
      <Link className="btn btn--sm btn--quiet" href="/signin">
        Log in
      </Link>
    )
  }

  async function signOut() {
    await createBrowserAuthClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <span className="row">
      <span className="label" title={email ?? undefined}>
        {shorten(email)}
      </span>
      <button type="button" className="btn btn--sm btn--quiet" onClick={() => void signOut()}>
        Sign out
      </button>
    </span>
  )
}

/** The app bar is narrow on a phone; the local part is the identifying bit. */
function shorten(email: string | null): string {
  if (!email) return 'Signed in'
  const [local] = email.split('@')
  return local && local.length > 14 ? `${local.slice(0, 13)}…` : (local ?? email)
}
