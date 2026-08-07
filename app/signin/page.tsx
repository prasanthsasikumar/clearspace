import { AppBar } from '@/components/AppBar'
import { SignIn } from '@/components/SignIn'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const { next, error } = await searchParams

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
              <span>
                {error === 'exchange_failed'
                  ? 'That link has already been used or has expired. Ask for a new one.'
                  : 'That sign-in link was incomplete. Ask for a new one.'}
              </span>
            </p>
          ) : null}

          <SignIn next={next ?? '/'} />
        </div>
      </main>
    </div>
  )
}
