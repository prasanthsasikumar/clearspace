import { env, isDemoMode } from '@/config/env'
import { FixtureVisionProvider } from './fixture-provider'
import { FixtureObjectMatcher } from './fixture-matcher'
import { FixtureEnricher, type Enricher } from './enricher'
import { GeminiClient } from './gemini/client'
import { GeminiEnricher } from './gemini/enrichment'
import { GeminiObjectMatcher } from './gemini/matcher'
import { GeminiVisionProvider } from './gemini/provider'
import type { ObjectMatcher } from './object-matcher'
import type { VisionProvider } from './vision-provider'

const globalForAi = globalThis as unknown as {
  __clearspaceGemini?: GeminiClient
  __clearspaceVision?: VisionProvider
  __clearspaceMatcher?: ObjectMatcher
  __clearspaceEnricher?: Enricher
}

/** One client, shared by every adapter, so retry policy is configured once. */
function getGeminiClient(): GeminiClient {
  if (!globalForAi.__clearspaceGemini) {
    globalForAi.__clearspaceGemini = new GeminiClient({
      apiKey: env.GEMINI_API_KEY!,
      model: env.GEMINI_MODEL,
    })
  }
  return globalForAi.__clearspaceGemini
}

/**
 * Resolves the vision provider. With no API key configured the app falls back
 * to recorded fixtures rather than failing; a fresh clone should be explorable
 * before anyone signs up for anything.
 */
export function getVisionProvider(): VisionProvider {
  if (!globalForAi.__clearspaceVision) {
    globalForAi.__clearspaceVision = isDemoMode
      ? new FixtureVisionProvider()
      : new GeminiVisionProvider({ client: getGeminiClient() })
  }
  return globalForAi.__clearspaceVision
}

export function getObjectMatcher(): ObjectMatcher {
  if (!globalForAi.__clearspaceMatcher) {
    globalForAi.__clearspaceMatcher = isDemoMode
      ? new FixtureObjectMatcher()
      : new GeminiObjectMatcher({ client: getGeminiClient() })
  }
  return globalForAi.__clearspaceMatcher
}

export function getEnricher(): Enricher {
  if (!globalForAi.__clearspaceEnricher) {
    globalForAi.__clearspaceEnricher = isDemoMode
      ? new FixtureEnricher()
      : new GeminiEnricher({ client: getGeminiClient() })
  }
  return globalForAi.__clearspaceEnricher
}

export * from './vision-provider'
export * from './object-matcher'
export * from './enricher'
export { FixtureVisionProvider } from './fixture-provider'
export { FixtureObjectMatcher, groupByLabel } from './fixture-matcher'
export { GeminiVisionProvider } from './gemini/provider'
export { GeminiObjectMatcher } from './gemini/matcher'
