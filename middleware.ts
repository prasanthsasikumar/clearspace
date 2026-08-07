import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Keeps a session attached to every request, and creates an anonymous one when
 * there is none.
 *
 * This is what makes "use it now, sign in to keep it" work without a claim
 * step. A first-time visitor is signed in anonymously before the page renders,
 * so their lot, photos, and listings are persisted server-side from the very
 * first upload. Adding an email or linking Google later keeps the same
 * Supabase user id, so nothing has to be migrated at the moment they commit,
 * which is precisely the moment you cannot afford to lose someone's work.
 *
 * Middleware is the right place because it is the only one that can both read
 * and write cookies before rendering. Server components can read a session but
 * never establish one.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Auth unconfigured: the app runs as a single local user and needs no session.
  if (!url || !key) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()

  if (!data.user) {
    // If anonymous sign-ins are disabled in the project, this fails and the
    // request simply continues unauthenticated. The app then shows the
    // sign-in screen rather than breaking.
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      console.warn('[auth] anonymous sign-in unavailable:', error.message)
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, the blob proxy, and the queue tick.
     * The tick is called by a scheduler that has no cookies and authenticates
     * with its own secret; running it through session handling would be pure
     * overhead on every minute of every day.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|api/blobs|api/jobs).*)',
  ],
}
