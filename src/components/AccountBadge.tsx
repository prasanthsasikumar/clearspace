'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserAuthClient } from '@/auth/browser'

/**
 * Who you are, in the app bar.
 *
 * An anonymous visitor gets a plain "Save your work" link rather than a nag —
 * their work genuinely is saved, just to a browser rather than to them, and
 * the copy should not pretend otherwise.
 */
export function AccountBadge({
  email,
  isAnonymous,
}: {
  email: string | null
  isAnonymous: boolean
}) {
  const router = useRouter()

  if (isAnonymous) {
    return (
      <Link className="btn btn--sm btn--primary" href="/signin">
        Save your work
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
