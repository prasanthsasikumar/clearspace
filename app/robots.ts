import type { MetadataRoute } from 'next'
import { SITE_ORIGIN } from '@/config/site'

/**
 * One page is for the public; everything else is somebody's inventory.
 *
 * The app routes sit behind an anonymous session rather than a login wall, so
 * a crawler reaching `/lots` is issued a session and served an empty board.
 * Indexed, that is thin duplicate content pointing at the product with none of
 * the argument for it, and it competes with the page written to make that
 * argument. `Disallow` keeps crawlers out; the `noindex` in the app layout is
 * the belt to this braces, for anything that reaches a route another way.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/lots', '/items', '/scans', '/batches', '/signin', '/auth/', '/api/'],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  }
}
