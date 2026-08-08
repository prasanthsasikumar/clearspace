import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /*
   * The front door is the marketing page, not the app.
   *
   * Nearly everyone who reaches the root arrived from a cold email and has
   * never heard of us; dropping them into an empty lots list explains nothing.
   * The page itself is a built artifact rather than a route because it is one
   * self-contained file with its own fonts and type scale, and rendering it
   * through the app's layout would pull in a stylesheet written for a phone
   * held one-handed in a storage unit.
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
