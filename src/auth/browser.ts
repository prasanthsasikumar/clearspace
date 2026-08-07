import { createBrowserClient } from '@supabase/ssr'

/**
 * The browser-side auth client.
 *
 * Deliberately separate from the server client and from `config/env`. That
 * module reads `node:fs` to load `.env.local` for scripts, and importing it
 * from a client component drags Node built-ins into the browser bundle, which
 * fails the build in a way whose error message names neither file.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so reading them straight
 * from `process.env` here is both correct and the only thing that bundles.
 */
export function createBrowserAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    )
  }

  return createBrowserClient(url, key)
}
