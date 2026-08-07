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
  }
}
