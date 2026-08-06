import { describe, expect, it } from 'vitest'
import { adviceFor, isUsable, scoreQuality } from '@/domain/image-quality'

const sharpPhoto = {
  laplacianVariance: 600,
  meanLuminance: 0.5,
  width: 2048,
  height: 1536,
}

describe('scoreQuality', () => {
  it('passes a sharp, well-exposed photo with no issues', () => {
    const quality = scoreQuality(sharpPhoto)
    expect(quality.issues).toEqual([])
    expect(quality.blurScore).toBe(1)
  })

  it('flags a smeared photo as blurry', () => {
    const quality = scoreQuality({ ...sharpPhoto, laplacianVariance: 40 })
    expect(quality.issues).toContain('blurry')
  })

  it('flags the storage-unit-with-one-bulb case', () => {
    const quality = scoreQuality({ ...sharpPhoto, meanLuminance: 0.1 })
    expect(quality.issues).toContain('too_dark')
  })

  it('flags a photo shot into direct sun', () => {
    const quality = scoreQuality({ ...sharpPhoto, meanLuminance: 0.95 })
    expect(quality.issues).toContain('too_bright')
  })

  it('flags an image too small to read a label from', () => {
    const quality = scoreQuality({ ...sharpPhoto, width: 480, height: 360 })
    expect(quality.issues).toContain('low_resolution')
  })

  it('keeps scores inside 0-1 even for absurd measurements', () => {
    const quality = scoreQuality({
      laplacianVariance: 1e9,
      meanLuminance: 12,
      width: 100,
      height: 100,
    })
    expect(quality.blurScore).toBe(1)
    expect(quality.exposure).toBe(1)
  })

  it('survives a NaN measurement rather than propagating it', () => {
    const quality = scoreQuality({ ...sharpPhoto, laplacianVariance: Number.NaN })
    expect(Number.isFinite(quality.blurScore)).toBe(true)
  })
})

describe('isUsable', () => {
  it('rejects blurry and dark photos but tolerates minor ones', () => {
    expect(isUsable(scoreQuality({ ...sharpPhoto, laplacianVariance: 10 }))).toBe(false)
    expect(isUsable(scoreQuality({ ...sharpPhoto, meanLuminance: 0.05 }))).toBe(false)
    expect(isUsable(scoreQuality({ ...sharpPhoto, width: 400, height: 300 }))).toBe(true)
  })

  it('treats an unscored photo as usable rather than blocking the user', () => {
    expect(isUsable(null)).toBe(true)
  })
})

describe('adviceFor', () => {
  it('gives one actionable instruction for the worst issue', () => {
    const advice = adviceFor(scoreQuality({ ...sharpPhoto, laplacianVariance: 10 }))
    expect(advice).toMatch(/focus/i)
  })

  it('says nothing about a good photo', () => {
    expect(adviceFor(scoreQuality(sharpPhoto))).toBeNull()
  })
})
