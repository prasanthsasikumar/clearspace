import { env, isDemoMode } from '@/config/env'
import { FixtureVisionProvider } from './fixture-provider'
import { GeminiVisionProvider } from './gemini/provider'
import type { VisionProvider } from './vision-provider'

const globalForAi = globalThis as unknown as { __sortaVision?: VisionProvider }

/**
 * Resolves the vision provider for the running process. With no API key
 * configured the app falls back to recorded fixtures rather than failing —
 * a fresh clone should be explorable before anyone signs up for anything.
 */
export function getVisionProvider(): VisionProvider {
  if (!globalForAi.__sortaVision) {
    globalForAi.__sortaVision = isDemoMode
      ? new FixtureVisionProvider()
      : new GeminiVisionProvider({
          apiKey: env.GEMINI_API_KEY!,
          model: env.GEMINI_MODEL,
        })
  }
  return globalForAi.__sortaVision
}

export * from './vision-provider'
export { FixtureVisionProvider } from './fixture-provider'
export { GeminiVisionProvider } from './gemini/provider'
