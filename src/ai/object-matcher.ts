export interface MatchCandidate {
  id: string
  label: string
  image: { data: Buffer; mimeType: string }
}

export interface MatchObjectsInput {
  /** All from one category bucket — the matcher never sees a mixed set. */
  candidates: readonly MatchCandidate[]
  categoryHint?: string
}

/**
 * Decides which crops show the same physical object.
 *
 * Its own port rather than a method on `VisionProvider` because it is the one
 * piece most likely to be replaced: an embedding model plus a clustering pass
 * would implement this interface and nothing else, and the service that calls
 * it would not change a line.
 *
 * The contract: return groups of candidate ids. Ids may be omitted (they become
 * single-view objects), and the caller repairs duplicates and unknown ids —
 * see `domain/grouping.ts`. A matcher is never trusted with correctness, only
 * with judgement.
 */
export interface ObjectMatcher {
  readonly name: string
  matchObjects(input: MatchObjectsInput): Promise<string[][]>
}

/**
 * The safe answer: every crop is its own object.
 *
 * Used when there is nothing to compare, and as the fallback when a matcher
 * fails. Duplicated listings are visible and deletable; a merge that swallows
 * an item is neither, so failure biases this way on purpose.
 */
export function noMatches(candidates: readonly MatchCandidate[]): string[][] {
  return candidates.map((candidate) => [candidate.id])
}
