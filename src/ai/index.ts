import { env, isDemoMode } from '@/config/env'
import { FixtureVisionProvider } from './fixture-provider'
import { FixtureObjectMatcher } from './fixture-matcher'
import { GeminiClient } from './gemini/client'
import { GeminiObjectMatcher } from './gemini/matcher'
import { GeminiVisionProvider } from './gemini/provider'
import type { ObjectMatcher } from './object-matcher'
import type { VisionProvider } from './vision-provider'

const globalForAi = globalThis as unknown as {
  __sortaGemini?: GeminiClient
  __sortaVision?: VisionProvider
  __sortaMatcher?: ObjectMatcher
}

/** One client, shared by every adapter, so retry policy is configured once. */
function getGeminiClient(): GeminiClient {
  if (!globalForAi.__sortaGemini) {
    globalForAi.__sortaGemini = new GeminiClient({
      apiKey: env.GEMINI_API_KEY!,
      model: env.GEMINI_MODEL,
    })
  }
  return globalForAi.__sortaGemini
}

/**
 * Resolves the vision provider. With no API key configured the app falls back
 * to recorded fixtures rather than failing — a fresh clone should be explorable
 * before anyone signs up for anything.
 */
export function getVisionProvider(): VisionProvider {
  if (!globalForAi.__sortaVision) {
    globalForAi.__sortaVision = isDemoMode
      ? new FixtureVisionProvider()
      : new GeminiVisionProvider({ client: getGeminiClient() })
  }
  return globalForAi.__sortaVision
}

export function getObjectMatcher(): ObjectMatcher {
  if (!globalForAi.__sortaMatcher) {
    globalForAi.__sortaMatcher = isDemoMode
      ? new FixtureObjectMatcher()
      : new GeminiObjectMatcher({ client: getGeminiClient() })
  }
  return globalForAi.__sortaMatcher
}

export * from './vision-provider'
export * from './object-matcher'
export { FixtureVisionProvider } from './fixture-provider'
export { FixtureObjectMatcher, groupByLabel } from './fixture-matcher'
export { GeminiVisionProvider } from './gemini/provider'
export { GeminiObjectMatcher } from './gemini/matcher'
