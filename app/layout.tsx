import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { isDemoMode } from '@/config/env'
import { SITE_ORIGIN } from '@/config/site'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const TAGLINE = 'photographs in, numbered lots out'
const BLURB =
  'Clearspace turns the photographs your staff already take into a finished auction catalogue: numbered lots, written descriptions, condition, and a researched low/high estimate with its sources.'

export const metadata: Metadata = {
  /*
   * Absolute URLs, because a link is mostly encountered somewhere else. A
   * message app fetches these before it draws the bubble, and relative paths
   * resolve against nothing when it does.
   */
  metadataBase: new URL(SITE_ORIGIN),
  title: 'Clearspace',
  description: BLURB,
  applicationName: 'Clearspace',
  appleWebApp: { capable: true, title: 'Clearspace', statusBarStyle: 'default' },
  /*
   * Every route under this layout is someone's working inventory, reached
   * through an anonymous session rather than a login. None of it should turn
   * up in a search result. The marketing page is a static file served through
   * a rewrite, so it never sees this layout and stays indexable.
   */
  robots: { index: false, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'Clearspace',
    title: `Clearspace: ${TAGLINE}`,
    description: BLURB,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Clearspace' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `Clearspace: ${TAGLINE}`,
    description: BLURB,
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The app bar and action bar sit against the notch and home indicator.
  viewportFit: 'cover',
  themeColor: '#f7f8fb',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {isDemoMode ? (
          <div className="demostrip">
            <span className="demostrip__glyph" aria-hidden="true">
              ◇
            </span>
            Demo mode: detections come from a recording, not a live model.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  )
}
