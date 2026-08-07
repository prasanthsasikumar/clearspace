import type { MatchCandidate, MatchObjectsInput, ObjectMatcher } from './object-matcher'

export type MatchStrategy = (candidates: readonly MatchCandidate[]) => string[][]

/**
 * Groups crops that carry the same label.
 *
 * A stand-in for visual comparison that is deterministic, free, and wrong in an
 * instructive direction: it merges everything a real matcher would have to
 * distinguish, which means the guard rails in `domain/grouping.ts` are the only
 * thing standing between it and a mess. Tests running against this matcher are
 * therefore testing the guard rails hard, which is exactly what should be
 * tested hardest: the model's judgement can improve, but a lost item is lost.
 */
export const groupByLabel: MatchStrategy = (candidates) => {
  const byLabel = new Map<string, string[]>()
  for (const candidate of candidates) {
    const key = candidate.label.trim().toLowerCase()
    const group = byLabel.get(key) ?? []
    group.push(candidate.id)
    byLabel.set(key, group)
  }
  return [...byLabel.values()]
}

export class FixtureObjectMatcher implements ObjectMatcher {
  readonly name = 'fixture-matcher'

  constructor(
    private readonly strategy: MatchStrategy = groupByLabel,
    private readonly error?: Error,
  ) {}

  async matchObjects(input: MatchObjectsInput): Promise<string[][]> {
    if (this.error) throw this.error
    return this.strategy(input.candidates)
  }
}
