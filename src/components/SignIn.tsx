'use client'

import { useState } from 'react'
import { createBrowserAuthClient } from '@/auth/browser'

type Phase =
  | { name: 'idle' }
  | { name: 'sending' }
  | { name: 'sent'; email: string }
  | { name: 'failed'; message: string }

/**
 * Sign-in.
 *
 * Always a plain sign-in, never an upgrade in place. Linking the identity onto
 * the anonymous session was the tidier idea and it worked exactly once per
 * account: every later visit arrived as a fresh anonymous user, Supabase
 * refused to attach an identity it had already given away, and there was no
 * way back in. Signing in normally cannot collide with anything.
 *
 * What that gives up is the free upgrade, where the lot you just photographed
 * was already yours because the id never changed. `/api/auth/claim` buys it
 * back: it tickets this anonymous session before the browser leaves, and the
 * callback moves the work across once the sign-in lands.
 */
export function SignIn({ next = '/' }: { next?: string }) {
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
      await ticketAnonymousWork()

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
      await ticketAnonymousWork()

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
      <button
        type="button"
        className="btn btn--block"
        onClick={() => void withGoogle()}
        disabled={phase.name === 'sending'}
      >
        Continue with Google
      </button>

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

/**
 * Tickets this browser's anonymous work so the callback can move it across.
 *
 * Best-effort on purpose. A visitor with nothing to move gets no ticket, and a
 * failure here must never block the sign-in itself: losing the transfer is a
 * disappointment, losing the sign-in is the bug this whole change exists to
 * fix.
 */
async function ticketAnonymousWork(): Promise<void> {
  try {
    await fetch('/api/auth/claim', { method: 'POST' })
  } catch {
    // Offline, or the endpoint is unreachable. Sign-in still proceeds.
  }
}
