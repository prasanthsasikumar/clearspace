'use client'

import { useState } from 'react'
import { createBrowserAuthClient } from '@/auth/browser'

type Phase =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; email: string }
  | { name: 'failed'; message: string }

/**
 * Sign-in, for someone who already has work in the app.
 *
 * Both routes upgrade the anonymous account in place rather than creating a
 * second one (`updateUser` for email, `linkIdentity` for Google), so the lot
 * they just photographed is still theirs afterwards. Signing in normally is
 * the fallback for a visitor arriving on a new device.
 *
 * `directSignIn` turns the linking off. It is set in the two cases where
 * linking cannot succeed: this browser has nothing to keep, so the visitor is
 * somebody returning on a new device, or Supabase has already refused because
 * the identity belongs to another account. Linking again would refuse again,
 * forever, which is what made signing in work exactly once per account.
 *
 * `warnWorkStays` is separate on purpose. It is only true when there is work
 * in this browser that signing in elsewhere would leave behind, and saying so
 * to someone with an empty session would be a warning about nothing.
 */
export function SignIn({
  next = '/',
  directSignIn = false,
  warnWorkStays = false,
}: {
  next?: string
  directSignIn?: boolean
  warnWorkStays?: boolean
}) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })

  const redirectTo =
    typeof window === 'undefined'
      ? undefined
      : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  async function withEmail(event: React.FormEvent) {
    event.preventDefault()
    const address = email.trim()
    if (!address) {
      setPhase({ name: 'failed', message: 'Enter your email address.' })
      return
    }

    setPhase({ name: 'sending' })
    const supabase = createBrowserAuthClient()

    try {
      const { data } = await supabase.auth.getUser()

      // An anonymous visitor with work in this browser gets that account
      // upgraded, so nothing they have already done is stranded somewhere they
      // cannot reach. With nothing here to keep, upgrading would only collide
      // with the account that already owns the address.
      if (data.user?.is_anonymous && !directSignIn) {
        const { error } = await supabase.auth.updateUser({ email: address })
        if (error) throw error
        setPhase({ name: 'sent', email: address })
        return
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) throw error
      setPhase({ name: 'sent', email: address })
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof Error ? error.message : 'Could not send that link.',
      })
    }
  }

  async function withGoogle() {
    setPhase({ name: 'sending' })
    const supabase = createBrowserAuthClient()

    try {
      const { data } = await supabase.auth.getUser()

      if (data.user?.is_anonymous && !directSignIn) {
        const { error } = await supabase.auth.linkIdentity({
          provider: 'google',
          options: { redirectTo },
        })
        if (error) throw error
        return
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      if (error) throw error
    } catch (error) {
      setPhase({
        name: 'failed',
        message: error instanceof Error ? error.message : 'Could not reach Google.',
      })
    }
  }

  if (phase.name === 'sent') {
    return (
      <div className="panel">
        <div className="panel__head">
          <span className="label">Check your email</span>
        </div>
        <div className="panel__body stack">
          <p>
            A sign-in link is on its way to <strong>{phase.email}</strong>. Open it on this
            device and everything you have photographed stays where it is.
          </p>
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => setPhase({ name: 'idle' })}
          >
            Use a different address
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stack stack--loose">
      <div className="stack stack--tight">
        <button
          type="button"
          className="btn btn--block"
          onClick={() => void withGoogle()}
          disabled={phase.name === 'sending'}
        >
          Continue with Google
        </button>
        {warnWorkStays ? (
          <span className="meta">
            This opens the account that Google is already connected to. Photos taken in this
            browser stay on the account you are in now.
          </span>
        ) : null}
      </div>

      <div className="row row--between">
        <span className="rule" style={{ flex: 1 }} />
        <span className="label">or</span>
        <span className="rule" style={{ flex: 1 }} />
      </div>

      <form className="stack" onSubmit={withEmail}>
        <div className="field">
          <label className="label" htmlFor="signin-email">
            Email
          </label>
          <input
            id="signin-email"
            className="field__control"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <span className="meta">
            We send a link. There is no password to invent or forget.
          </span>
        </div>

        {phase.name === 'failed' ? (
          <p className="field__error">
            <span aria-hidden="true">⚠</span>
            {phase.message}
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={phase.name === 'sending'}
          data-state={phase.name === 'sending' ? 'loading' : undefined}
        >
          {phase.name === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>
    </div>
  )
}
