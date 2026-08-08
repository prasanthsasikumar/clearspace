import { AppBar } from '@/components/AppBar'
import { SignIn } from '@/components/SignIn'

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
    'That account is already connected to Clearspace. Try again and it will open the account it belongs to.',
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

  return (
    <div className="shell">
      <AppBar back={{ href: next ?? '/lots', label: 'Back' }} title="Sign in" />
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

          <SignIn next={next ?? '/lots'} />
        </div>
      </main>
    </div>
  )
}
