import { describe, expect, it } from 'vitest'
import { buildMatcherPrompt, matcherResponseSchema, toIdGroups } from '@/ai/gemini/matcher'
import { FixtureObjectMatcher, groupByLabel } from '@/ai/fixture-matcher'
import { noMatches, type MatchCandidate } from '@/ai/object-matcher'

const candidate = (id: string, label = 'chair'): MatchCandidate => ({
  id,
  label,
  image: { data: Buffer.from('x'), mimeType: 'image/jpeg' },
})

describe('buildMatcherPrompt', () => {
  it('states that matching models are not the same object', () => {
    const prompt = buildMatcherPrompt(6)
    expect(prompt).toMatch(/same make and model are NOT the same object/i)
    expect(prompt).toMatch(/four matching dining chairs are four objects/i)
  })

  it('tells the model to fail toward separate', () => {
    const prompt = buildMatcherPrompt(6)
    expect(prompt).toMatch(/if you are unsure, keep them separate/i)
    expect(prompt).toMatch(/destroys a record/i)
  })

  it('names the range every image number must fall in', () => {
    expect(buildMatcherPrompt(9)).toContain('1 to 9')
  })

  it('passes the category through when there is one', () => {
    expect(buildMatcherPrompt(3, 'tools')).toContain('tools')
  })
})

describe('matcherResponseSchema', () => {
  it('accepts a well-formed reply', () => {
    const parsed = matcherResponseSchema.parse({ groups: [{ image_numbers: [1, 3] }] })
    expect(parsed.groups[0]!.image_numbers).toEqual([1, 3])
  })

  it('defaults an absent groups array rather than throwing', () => {
    expect(matcherResponseSchema.parse({}).groups).toEqual([])
  })
})

describe('toIdGroups', () => {
  const candidates = [candidate('a'), candidate('b'), candidate('c')]

  it('maps 1-based image numbers back to ids', () => {
    expect(toIdGroups([{ image_numbers: [1, 3] }], candidates)).toEqual([['a', 'c']])
  })

  it('drops numbers outside the range it sent', () => {
    expect(toIdGroups([{ image_numbers: [1, 9, 0, -2] }], candidates)).toEqual([['a']])
  })

  it('drops a group that mapped to nothing', () => {
    expect(toIdGroups([{ image_numbers: [42] }], candidates)).toEqual([])
  })

  it('tolerates a float where an integer was asked for', () => {
    expect(toIdGroups([{ image_numbers: [2.0] }], candidates)).toEqual([['b']])
  })

  it('does not add back ids the model omitted — that repair belongs downstream', () => {
    expect(toIdGroups([{ image_numbers: [1] }], candidates)).toEqual([['a']])
  })
})

describe('noMatches', () => {
  it('makes every crop its own object', () => {
    expect(noMatches([candidate('a'), candidate('b')])).toEqual([['a'], ['b']])
  })
})

describe('FixtureObjectMatcher', () => {
  it('groups crops sharing a label', async () => {
    const matcher = new FixtureObjectMatcher()
    const groups = await matcher.matchObjects({
      candidates: [candidate('a', 'chair'), candidate('b', 'Chair'), candidate('c', 'lamp')],
    })
    expect(groups.find((g) => g.includes('a'))).toEqual(['a', 'b'])
    expect(groups.find((g) => g.includes('c'))).toEqual(['c'])
  })

  it('can be told to fail, so the fallback path is testable', async () => {
    const matcher = new FixtureObjectMatcher(groupByLabel, new Error('matcher down'))
    await expect(matcher.matchObjects({ candidates: [candidate('a')] })).rejects.toThrow(
      'matcher down',
    )
  })
})
