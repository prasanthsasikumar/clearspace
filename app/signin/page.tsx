import { AppBar } from '@/components/AppBar'
import { SignIn } from '@/components/SignIn'
import { getAppContext } from '@/server/context'
import { requireSessionUser } from '@/server/auth'
import { listLots } from '@/services/lots'

export const dynamic = 'force-dynamic'

/**
 * What went wrong, in the words of the person it happened to.
 *
 * `identity_already_exists` is the one that matters. It means the Google
 * account is already attached to a different Clearspace account, and no amount
 * of trying again will change that, so the copy has to say which account is in
 * the way instead of asking for another attempt.
 */
const MESSAGES: Record<string, string> = {
  identity_already_exists:
    'That Google account is already connected to another Clearspace account. Continue with Google to open that one instead, or use your email to keep what is in this browser.',
  exchange_failed: 'That link has already been used or has expired. Ask for a new one.',
  missing_code: 'That sign-in link was incomplete. Ask for a new one.',
  provider_error: 'Google could not finish that sign-in. Try again, or use your email.',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams

  /*
   * Everyone who opens the app is signed in anonymously before they reach
   * this page, so "are you new?" is not the same question as "is this session
   * anonymous?". The one that matters is whether this browser has anything to
   * lose: with nothing here, the visitor is somebody coming back on a new
   * device, and the right move is to sign them straight in rather than to try
   * to graft their Google account onto an empty session it will refuse.
   */
  const { db } = getAppContext()
  const user = await requireSessionUser(db)
  const lots = await listLots(db, user.id)
  const returning = user.isAnonymous && lots.length === 0

  return (
    <div className="shell">
      <AppBar back={{ href: next ?? '/', label: 'Back' }} title="Sign in" />
      <main className="page">
        <div className="stack stack--loose">
          <div className="stack stack--tight">
            <h1>Keep what you have sorted.</h1>
            <p className="lede">
              Everything you have photographed so far is already saved to this browser. Signing
              in attaches it to you, so it survives a cleared cache and follows you to another
              device.
            </p>
          </div>

          {error ? (
            <p className="notice notice--danger" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>{MESSAGES[error] ?? MESSAGES.provider_error}</span>
            </p>
          ) : null}

          <SignIn
            next={next ?? '/'}
            directSignIn={returning || error === 'identity_already_exists'}
            warnWorkStays={error === 'identity_already_exists'}
          />
        </div>
      </main>
    </div>
  )
}
