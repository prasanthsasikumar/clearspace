import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google'
import './globals.css'
import { isDemoMode } from '@/config/env'

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

export const metadata: Metadata = {
  title: 'Sorta',
  description: 'Point a phone at a room. Get a sellable inventory.',
  applicationName: 'Sorta',
  appleWebApp: { capable: true, title: 'Sorta', statusBarStyle: 'default' },
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
            Demo mode — detections come from a recording, not a live model.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  )
}
