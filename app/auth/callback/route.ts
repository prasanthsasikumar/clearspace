import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerAuthClient } from '@/auth/supabase'
import { isAuthEnabled } from '@/config/env'

/**
 * Where Google and the email magic link land.
 *
 * Exchanges the one-time code for a session and sends the visitor back where
 * they were. Because the anonymous account is upgraded in place rather than
 * replaced, whatever they had already photographed is simply still there.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/'

  if (!isAuthEnabled || !code) {
    return NextResponse.redirect(new URL('/signin?error=missing_code', url.origin))
  }

  const store = await cookies()
  const supabase = createServerAuthClient({
    getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (toSet) => {
      for (const c of toSet) store.set(c.name, c.value, c.options)
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/signin?error=exchange_failed', url.origin))
  }

  // Only same-origin paths, so a crafted link cannot bounce someone off-site.
  const destination = next.startsWith('/') ? next : '/'
  return NextResponse.redirect(new URL(destination, url.origin))
}
