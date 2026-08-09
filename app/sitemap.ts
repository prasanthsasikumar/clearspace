import type { MetadataRoute } from 'next'
import { SITE_ORIGIN } from '@/config/site'

/**
 * One entry, honestly.
 *
 * Everything else the app serves is a private board or a route behind a
 * session, and padding a sitemap with pages that answer no query is how a
 * small site teaches a crawler to trust it less.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${SITE_ORIGIN}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
