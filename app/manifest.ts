import type { MetadataRoute } from 'next'

/**
 * Installing Sorta to the home screen is not a nicety — a storage unit has bad
 * signal and a tab that reloads mid-scan loses the user's place. Standalone
 * display keeps the capture flow intact across app switches.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sorta',
    short_name: 'Sorta',
    description: 'Point a phone at a room. Get a sellable inventory.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f8fb',
    theme_color: '#f7f8fb',
    orientation: 'portrait',
  }
}
