import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
