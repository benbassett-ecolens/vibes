import { describe, expect, it } from 'vitest'
import { isAllowedIdentity, signSession, verifySession } from './auth.js'

describe('isAllowedIdentity', () => {
  const ok = { email: 'ben@ecolens.io', email_verified: true, hd: 'ecolens.io' }
  it('accepts a verified Workspace account in the allowed domain', () => {
    expect(isAllowedIdentity(ok, 'ecolens.io')).toBe(true)
  })
  it('is case-insensitive on email and hd', () => {
    expect(isAllowedIdentity({ ...ok, email: 'Ben@Ecolens.IO', hd: 'Ecolens.io' }, 'ecolens.io')).toBe(true)
  })
  it('rejects a missing hd claim (consumer Gmail)', () => {
    expect(isAllowedIdentity({ email: 'someone@gmail.com', email_verified: true }, 'ecolens.io')).toBe(false)
  })
  it('rejects another Workspace domain', () => {
    expect(isAllowedIdentity({ ...ok, email: 'x@other.com', hd: 'other.com' }, 'ecolens.io')).toBe(false)
  })
  it('rejects hd mismatch even when email looks right', () => {
    expect(isAllowedIdentity({ ...ok, hd: 'other.com' }, 'ecolens.io')).toBe(false)
  })
  it('rejects lookalike domains', () => {
    expect(isAllowedIdentity({ email: 'a@ecolens.io.evil.com', email_verified: true, hd: 'ecolens.io.evil.com' }, 'ecolens.io')).toBe(false)
    expect(isAllowedIdentity({ email: 'a@notecolens.io', email_verified: true, hd: 'ecolens.io' }, 'ecolens.io')).toBe(false)
  })
  it('rejects unverified email', () => {
    expect(isAllowedIdentity({ ...ok, email_verified: false }, 'ecolens.io')).toBe(false)
  })
})

describe('session tokens', () => {
  const secret = 'test-secret-test-secret-test-secret'
  it('round-trips', () => {
    const t = signSession({ uid: 'u1', exp: 2_000_000_000 }, secret)
    expect(verifySession(t, secret, 1_000_000_000_000)?.uid).toBe('u1')
  })
  it('rejects tampering', () => {
    const t = signSession({ uid: 'u1', exp: 2_000_000_000 }, secret)
    const [body, mac] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ uid: 'u2', exp: 2_000_000_000 })).toString('base64url')
    expect(verifySession(`${forged}.${mac}`, secret)).toBeNull()
    expect(verifySession(`${body}.${mac}x`, secret)).toBeNull()
    expect(verifySession(t, 'other-secret')).toBeNull()
  })
  it('rejects expired tokens', () => {
    const t = signSession({ uid: 'u1', exp: 1_000 }, secret)
    expect(verifySession(t, secret, 2_000 * 1000)).toBeNull()
  })
  it('rejects garbage', () => {
    expect(verifySession(undefined, secret)).toBeNull()
    expect(verifySession('nope', secret)).toBeNull()
    expect(verifySession('a.b', secret)).toBeNull()
  })
})
