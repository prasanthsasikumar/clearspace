'use client'

import { useEffect, useRef, useState } from 'react'
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
 *
 * Signed in, the name is a button and signing out lives behind it. Sitting the
 * two side by side spent app-bar width on an action taken roughly never, and
 * put a one-tap exit next to the thing a thumb reaches for on a phone.
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
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  /*
   * Escape and a click anywhere else both close it. A menu that can only be
   * dismissed by hitting the same small target again is a trap on a phone,
   * and `pointerdown` rather than `click` so it closes on the way down
   * instead of after whatever was underneath has already been pressed.
   */
  useEffect(() => {
    if (!open) return

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

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
    setOpen(false)
    await createBrowserAuthClient().auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <div className="account" ref={wrapRef}>
      <button
        type="button"
        className="account__button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="account__initial" aria-hidden="true">
          {initial(email)}
        </span>
        <span className="account__name">{shorten(email)}</span>
      </button>

      {open ? (
        <div className="account__menu" role="menu">
          {/* The full address, because the button only ever shows enough of it
              to recognise, and "which account am I in?" is the question this
              menu exists to answer. */}
          <span className="account__email">{email ?? 'Signed in'}</span>
          <button
            type="button"
            className="account__item"
            role="menuitem"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** The app bar is narrow on a phone; the local part is the identifying bit. */
function shorten(email: string | null): string {
  if (!email) return 'Signed in'
  const [local] = email.split('@')
  return local && local.length > 14 ? `${local.slice(0, 13)}…` : (local ?? email)
}

function initial(email: string | null): string {
  return (email?.trim()[0] ?? '?').toUpperCase()
}
