import { describe, expect, it } from 'vitest'
import {
  applyGrouping,
  bucketByCategory,
  describeGroup,
  mergeTransitive,
  splitBySourcePhoto,
  type Groupable,
} from '@/domain/grouping'

let seq = 0
function det(overrides: Partial<Groupable> = {}): Groupable {
  seq += 1
  return {
    id: `d${seq}`,
    scanId: 'photo-1',
    category: 'furniture',
    label: 'chair',
    confidence: 0.8,
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    ...overrides,
  }
}

describe('bucketByCategory', () => {
  it('never puts two categories in one bucket', () => {
    const buckets = bucketByCategory([
      det({ category: 'furniture' }),
      det({ category: 'tools' }),
      det({ category: 'furniture' }),
    ])
    for (const bucket of buckets) {
      const categories = new Set(bucket.members.map((m) => m.category))
      expect(categories.size).toBe(1)
    }
  })

  it('keeps uncategorised detections rather than stranding them', () => {
    const buckets = bucketByCategory([det({ category: null }), det({ category: null })])
    expect(buckets).toHaveLength(1)
    expect(buckets[0]!.members).toHaveLength(2)
  })

  it('chunks a bucket that grows past the limit', () => {
    const many = Array.from({ length: 25 }, () => det({ category: 'tools' }))
    const buckets = bucketByCategory(many, 10)
    expect(buckets.map((b) => b.members.length)).toEqual([10, 10, 5])
  })

  it('accounts for every detection exactly once', () => {
    const input = [
      det({ category: 'tools' }),
      det({ category: null }),
      det({ category: 'furniture' }),
      det({ category: 'tools' }),
    ]
    const seen = bucketByCategory(input, 2).flatMap((b) => b.members.map((m) => m.id))
    expect(seen.sort()).toEqual(input.map((i) => i.id).sort())
  })
})

describe('splitBySourcePhoto', () => {
  it('leaves a group of distinct photos alone', () => {
    const group = [det({ scanId: 'a' }), det({ scanId: 'b' }), det({ scanId: 'c' })]
    expect(splitBySourcePhoto(group)).toHaveLength(1)
  })

  it('splits two objects that came from the same photograph', () => {
    const a = det({ scanId: 'photo-1' })
    const b = det({ scanId: 'photo-1' })
    const c = det({ scanId: 'photo-2' })

    const slots = splitBySourcePhoto([a, b, c])

    expect(slots).toHaveLength(2)
    // The second view still attaches to one of them rather than being wasted.
    expect(slots[0]!.map((m) => m.id)).toEqual([a.id, c.id])
    expect(slots[1]!.map((m) => m.id)).toEqual([b.id])
  })

  it('produces one object per copy when a photo shows four matching chairs', () => {
    const four = Array.from({ length: 4 }, () => det({ scanId: 'photo-1' }))
    expect(splitBySourcePhoto(four)).toHaveLength(4)
  })

  it('pairs four chairs across two photos into four two-view objects', () => {
    const first = Array.from({ length: 4 }, () => det({ scanId: 'photo-1' }))
    const second = Array.from({ length: 4 }, () => det({ scanId: 'photo-2' }))

    const slots = splitBySourcePhoto([...first, ...second])

    expect(slots).toHaveLength(4)
    for (const slot of slots) expect(slot).toHaveLength(2)
  })

  it('never loses a member', () => {
    const members = [
      det({ scanId: 'a' }),
      det({ scanId: 'a' }),
      det({ scanId: 'a' }),
      det({ scanId: 'b' }),
    ]
    const flat = splitBySourcePhoto(members).flat()
    expect(flat.map((m) => m.id).sort()).toEqual(members.map((m) => m.id).sort())
  })
})

describe('mergeTransitive', () => {
  it('stitches groups that share a member across chunk boundaries', () => {
    const merged = mergeTransitive([
      ['a', 'b'],
      ['b', 'c'],
      ['x', 'y'],
    ])
    expect(merged).toHaveLength(2)
    expect(merged.find((g) => g.includes('a'))!.sort()).toEqual(['a', 'b', 'c'])
  })

  it('leaves disjoint groups alone', () => {
    expect(mergeTransitive([['a'], ['b'], ['c']])).toHaveLength(3)
  })

  it('handles a long chain without stack trouble', () => {
    const chain = Array.from({ length: 500 }, (_, i) => [`n${i}`, `n${i + 1}`])
    expect(mergeTransitive(chain)).toHaveLength(1)
  })
})

describe('applyGrouping', () => {
  it('turns a clean matcher answer into objects', () => {
    const a = det({ scanId: 'p1' })
    const b = det({ scanId: 'p2' })
    const c = det({ scanId: 'p3', label: 'lamp' })

    const groups = applyGrouping([a, b, c], [[a.id, b.id], [c.id]])

    expect(groups).toHaveLength(2)
    expect(groups[0]!.members).toHaveLength(2)
  })

  it('makes an object out of anything the matcher forgot', () => {
    const a = det({ scanId: 'p1' })
    const forgotten = det({ scanId: 'p2' })

    const groups = applyGrouping([a, forgotten], [[a.id]])

    expect(groups).toHaveLength(2)
    expect(groups.flatMap((g) => g.members.map((m) => m.id))).toContain(forgotten.id)
  })

  it('gives a detection claimed twice to the group that claimed it first', () => {
    const a = det({ scanId: 'p1' })
    const b = det({ scanId: 'p2' })

    const groups = applyGrouping([a, b], [[a.id, b.id], [b.id]])

    const assignments = groups.flatMap((g) => g.members.map((m) => m.id))
    expect(assignments.filter((id) => id === b.id)).toHaveLength(1)
  })

  it('ignores ids the matcher invented', () => {
    const a = det({ scanId: 'p1' })
    const groups = applyGrouping([a], [[a.id, 'never-sent-this']])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.members).toHaveLength(1)
  })

  it('splits a group the matcher built across one photograph', () => {
    const a = det({ scanId: 'p1' })
    const b = det({ scanId: 'p1' })

    const groups = applyGrouping([a, b], [[a.id, b.id]])

    expect(groups).toHaveLength(2)
  })

  it('never loses a detection, whatever the matcher returns', () => {
    const detections = [
      det({ scanId: 'p1' }),
      det({ scanId: 'p1' }),
      det({ scanId: 'p2' }),
      det({ scanId: 'p3' }),
    ]
    const nonsense = [
      [detections[0]!.id, 'ghost'],
      [detections[0]!.id, detections[1]!.id, detections[2]!.id],
      [],
    ]

    const groups = applyGrouping(detections, nonsense)
    const assigned = groups.flatMap((g) => g.members.map((m) => m.id)).sort()

    expect(assigned).toEqual(detections.map((d) => d.id).sort())
  })

  it('returns nothing for nothing', () => {
    expect(applyGrouping([], [])).toEqual([])
  })

  it('puts the objects with the most views first', () => {
    const a = det({ scanId: 'p1' })
    const b = det({ scanId: 'p2' })
    const lonely = det({ scanId: 'p3', label: 'lamp', category: 'furniture' })

    const groups = applyGrouping([lonely, a, b], [[a.id, b.id], [lonely.id]])

    expect(groups[0]!.members).toHaveLength(2)
  })
})

describe('describeGroup', () => {
  it('picks the most confident detection to represent the object', () => {
    const weak = det({ scanId: 'p1', confidence: 0.4 })
    const strong = det({ scanId: 'p2', confidence: 0.95 })
    expect(describeGroup([weak, strong]).representative.id).toBe(strong.id)
  })

  it('breaks a confidence tie toward the view that fills more frame', () => {
    const small = det({ scanId: 'p1', confidence: 0.8, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    const large = det({ scanId: 'p2', confidence: 0.8, bbox: { x: 0, y: 0, w: 0.5, h: 0.5 } })
    expect(describeGroup([small, large]).representative.id).toBe(large.id)
  })

  it('takes the name most of the views agreed on', () => {
    const group = [
      det({ scanId: 'p1', label: 'office chair', confidence: 0.9 }),
      det({ scanId: 'p2', label: 'desk chair' }),
      det({ scanId: 'p3', label: 'desk chair' }),
    ]
    expect(describeGroup(group).label).toBe('desk chair')
  })

  it('carries the representative’s category', () => {
    const group = [det({ scanId: 'p1', category: 'tools', confidence: 0.9 })]
    expect(describeGroup(group).category).toBe('tools')
  })
})
