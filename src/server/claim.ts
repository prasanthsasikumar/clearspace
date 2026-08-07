import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/config/env'

export const CLAIM_COOKIE = 'cs_claim'

/**
 * Long enough to read a consent screen and find the right Google account,
 * short enough that a ticket left on a shared machine is worth nothing.
 */
const TTL_MS = 15 * 60 * 1000

/**
 * A ticket saying "whoever completes the sign-in that follows may take this
 * anonymous account's work".
 *
 * It has to be signed. The cookie is HttpOnly, which stops a script reading
 * it, but nothing stops a crafted request from sending any value it likes, and
 * an unsigned ticket naming a user id is an invitation to name somebody
 * else's. The signature is what makes the id the server's own claim rather
 * than the client's assertion.
 *
 * The service key is the secret because it is the one value that is always
 * present when auth is configured and never reaches the browser. With no key,
 * ticketing is off and sign-in simply does not transfer anything.
 */
function keyMaterial(): string | null {
  return env.SUPABASE_SERVICE_KEY ?? null
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function issueClaim(userId: string, now: number = Date.now()): string | null {
  const secret = keyMaterial()
  if (!secret) return null
  const payload = `${userId}.${now + TTL_MS}`
  return `${payload}.${sign(payload, secret)}`
}

/**
 * Returns the user id the ticket vouches for, or null for anything at all
 * suspect: no secret, wrong shape, bad signature, or expired.
 */
export function readClaim(value: string | undefined | null, now: number = Date.now()): string | null {
  const secret = keyMaterial()
  if (!secret || !value) return null

  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [userId, expiresAt, signature] = parts as [string, string, string]

  const expected = sign(`${userId}.${expiresAt}`, secret)
  // Compared byte-wise in constant time, and only when the lengths already
  // match, because timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const deadline = Number(expiresAt)
  if (!Number.isFinite(deadline) || deadline < now) return null

  return userId || null
}
