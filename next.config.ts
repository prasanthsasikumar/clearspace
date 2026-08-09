import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
   * The marketing page's assets carry a content hash in the filename, so a
   * given URL can never change what it returns. That is what makes a year of
   * immutable caching correct rather than reckless: edit a photograph and the
   * hash changes, so returning visitors fetch a different URL rather than a
   * stale file.
   */
  async headers() {
    return [
      {
        source: '/site/assets/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
  /*
   * The front door is the marketing page, not the app.
   *
   * Nearly everyone who reaches the root arrived from a cold email and has
   * never heard of us; dropping them into an empty lots list explains nothing.
   * The page is a built artifact rather than a route because it carries its
   * own fonts and type scale, and rendering it through the app's layout would
   * pull in a stylesheet written for a phone held one-handed in a storage
   * unit.
   *
   * `beforeFiles` matters: it runs ahead of the filesystem, so this wins even
   * if a root page is ever added back by accident.
   */
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/site/index.html' }],
      afterFiles: [],
      fallback: [],
    }
  },
  // This repo maintains its own README; the auto-generated agent files are noise.
  agentRules: false,
  // sharp and PGlite ship native/WASM assets that must not be bundled.
  serverExternalPackages: ['sharp', '@electric-sql/pglite'],
  experimental: {
    // Scene photos from a modern phone camera are routinely 8-12 MB.
    serverActions: { bodySizeLimit: '25mb' },
  },
}

export default nextConfig
