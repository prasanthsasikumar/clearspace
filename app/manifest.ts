import type { MetadataRoute } from 'next'

/**
 * Installing Clearspace to the home screen is not a nicety: a storage unit has bad
 * signal and a tab that reloads mid-scan loses the user's place. Standalone
 * display keeps the capture flow intact across app switches.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Clearspace',
    short_name: 'Clearspace',
    description: 'Photograph the space. AI splits it into items, writes each listing, and gets them ready for Facebook Marketplace and eBay.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f8fb',
    theme_color: '#f7f8fb',
    orientation: 'portrait',
    /*
     * The SVG is the icon; the PNGs exist because two platforms will not take
     * it. iOS refuses SVG for a home-screen icon and falls back to a
     * screenshot of the page, and Chrome wants a 192 and a 512 before it will
     * call a site installable. All three are the same drawing, rasterised from
     * `app/icon.svg` rather than drawn again.
     */
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ],
  }
}
