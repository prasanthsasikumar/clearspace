import { describe, expect, it } from 'vitest'
import { zip } from '@/lib/zip'

describe('zip', () => {
  it('writes a local header, a central directory, and an end record', () => {
    const buf = zip([{ name: 'a.txt', data: Buffer.from('hello', 'utf8') }])

    expect(buf.readUInt32LE(0)).toBe(0x04034b50)
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50)
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(1)
  })

  it('stores rather than deflates, so entry bytes appear verbatim', () => {
    const buf = zip([{ name: 'a.txt', data: Buffer.from('hello', 'utf8') }])
    expect(buf.includes(Buffer.from('hello', 'utf8'))).toBe(true)
  })

  it('is byte-stable, so the same entries always produce the same file', () => {
    const once = zip([{ name: 'a.txt', data: Buffer.from('x') }])
    const twice = zip([{ name: 'a.txt', data: Buffer.from('x') }])
    expect(once.equals(twice)).toBe(true)
  })

  it('records every entry in the end-of-central-directory count', () => {
    const buf = zip([
      { name: '1_1.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) },
      { name: '1_2.jpg', data: Buffer.from([0xff, 0xd8, 0xfe]) },
      { name: 'lots.csv', data: Buffer.from('a,b\r\n', 'utf8') },
    ])
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(3)
  })
})
