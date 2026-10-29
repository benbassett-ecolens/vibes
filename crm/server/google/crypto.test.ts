import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from './crypto.js'

describe('token encryption', () => {
  it('round-trips and is randomized', () => {
    const a = encrypt('1//refresh-token', 'k'.repeat(40))
    const b = encrypt('1//refresh-token', 'k'.repeat(40))
    expect(a).not.toBe(b)
    expect(decrypt(a, 'k'.repeat(40))).toBe('1//refresh-token')
  })
  it('fails on the wrong key or tampering', () => {
    const a = encrypt('secret', 'k'.repeat(40))
    expect(() => decrypt(a, 'x'.repeat(40))).toThrow()
    expect(() => decrypt(a.slice(0, -2) + 'zz', 'k'.repeat(40))).toThrow()
  })
})
