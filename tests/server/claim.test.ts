import { beforeAll, describe, expect, it, vi } from 'vitest'

// The ticket is signed with the service key, so the module needs one before it
// is imported. Without a key, ticketing is off by design.
vi.mock('@/config/env', () => ({
  env: { SUPABASE_SERVICE_KEY: 'test-service-key' },
}))

let issueClaim: typeof import('@/server/claim').issueClaim
let readClaim: typeof import('@/server/claim').readClaim

beforeAll(async () => {
  ;({ issueClaim, readClaim } = await import('@/server/claim'))
})

/**
 * The ticket names a user id, and the callback hands that account's work to
 * whoever presents it. Everything here is about what happens when the value
 * arriving is not the value that was issued.
 */
describe('claim tickets', () => {
  const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('reads back the id it was issued for', () => {
    const ticket = issueClaim(user)
    expect(readClaim(ticket)).toBe(user)
  })

  it('rejects a ticket whose id was swapped for someone else’s', () => {
    const ticket = issueClaim(user)!
    const [, expiresAt, signature] = ticket.split('.')
    const forged = ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expiresAt, signature].join('.')
    expect(readClaim(forged)).toBeNull()
  })

  it('rejects a ticket whose expiry was pushed out', () => {
    const ticket = issueClaim(user)!
    const [id, , signature] = ticket.split('.')
    const forged = [id, String(Date.now() + 86_400_000), signature].join('.')
    expect(readClaim(forged)).toBeNull()
  })

  it('rejects an expired ticket', () => {
    const issuedAt = Date.now() - 60 * 60 * 1000
    const ticket = issueClaim(user, issuedAt)
    expect(readClaim(ticket)).toBeNull()
  })

  it('rejects an unsigned id, which is what a hand-written cookie looks like', () => {
    expect(readClaim(user)).toBeNull()
    expect(readClaim(`${user}.${Date.now() + 60_000}`)).toBeNull()
    expect(readClaim(`${user}.${Date.now() + 60_000}.`)).toBeNull()
  })

  it('rejects nothing at all', () => {
    expect(readClaim(undefined)).toBeNull()
    expect(readClaim('')).toBeNull()
    expect(readClaim(null)).toBeNull()
  })
})
