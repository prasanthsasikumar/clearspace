import { createServerClient } from '@supabase/ssr'
import { env } from '@/config/env'

/**
 * Supabase Auth clients.
 *
 * Sorta's own data never goes through Supabase's REST API — the app talks to
 * Postgres directly with Drizzle. Supabase is used purely as an identity
 * provider, which keeps the surface small: this reads and refreshes a session
 * cookie and nothing else.
 *
 * Server-only. The browser client lives in `auth/browser.ts` because this
 * module reaches `config/env`, which reads `node:fs`.
 */
export interface CookieAdapter {
  getAll(): Array<{ name: string; value: string }>
  setAll(cookies: Array<{ name: string; value: string; options?: object }>): void
}

export function createServerAuthClient(cookies: CookieAdapter) {
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookies.getAll(),
        setAll: (toSet) => cookies.setAll(toSet),
      },
    },
  )
}

export interface AuthIdentity {
  id: string
  email: string | null
  isAnonymous: boolean
}

/**
 * Supabase marks anonymous users with `is_anonymous` on the JWT. Falling back
 * to "no email means anonymous" keeps this correct even if that claim is
 * absent, because an account with no address cannot be signed back into.
 */
export function toIdentity(user: {
  id: string
  email?: string | null
  is_anonymous?: boolean
}): AuthIdentity {
  return {
    id: user.id,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous ?? !user.email,
  }
}
