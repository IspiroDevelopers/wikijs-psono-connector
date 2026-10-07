// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { base32Decode, parseTotpParams, totpAt, type TotpAlgorithm } from '../../src/sidecar/psono/totp'

// RFC 6238 Appendix B: 8 digits, period 30, ASCII seeds of 20/32/64 bytes.
const SEEDS: Record<TotpAlgorithm, Buffer> = {
  SHA1: Buffer.from('12345678901234567890'),
  SHA256: Buffer.from('12345678901234567890123456789012'),
  SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'), // check-repo:allow (public RFC 6238 test seed)
}
const VECTORS: Array<[number, TotpAlgorithm, string]> = [
  [59, 'SHA1', '94287082'], [59, 'SHA256', '46119246'], [59, 'SHA512', '90693936'],
  [1111111109, 'SHA1', '07081804'], [1111111109, 'SHA256', '68084774'], [1111111109, 'SHA512', '25091201'],
  [1111111111, 'SHA1', '14050471'], [1111111111, 'SHA256', '67062674'], [1111111111, 'SHA512', '99943326'],
  [1234567890, 'SHA1', '89005924'], [1234567890, 'SHA256', '91819424'], [1234567890, 'SHA512', '93441116'],
  [2000000000, 'SHA1', '69279037'], [2000000000, 'SHA256', '90698825'], [2000000000, 'SHA512', '38618901'],
  [20000000000, 'SHA1', '65353130'], [20000000000, 'SHA256', '77737706'], [20000000000, 'SHA512', '47863826'],
]

describe('totpAt — RFC 6238 Appendix B', () => {
  it.each(VECTORS)('t=%i %s → %s', (t, algorithm, expected) => {
    const code = totpAt({ secret: SEEDS[algorithm], period: 30, digits: 8, algorithm }, new Date(t * 1000))
    expect(code.code).toBe(expected)
  })

  it('reports the end of the current period', () => {
    const code = totpAt({ secret: SEEDS.SHA1, period: 30, digits: 6, algorithm: 'SHA1' }, new Date(59_000))
    expect(code.validUntil.toISOString()).toBe(new Date(60_000).toISOString())
    expect(code.periodSeconds).toBe(30)
  })
})

describe('base32Decode', () => {
  it('decodes RFC 4648 test vectors', () => {
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar')
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar')
  })
  it('rejects invalid input', () => {
    expect(() => base32Decode('MZXW1')).toThrow()
    expect(() => base32Decode('')).toThrow()
  })
})

describe('parseTotpParams', () => {
  it('uses Psono fields with sane defaults', () => {
    const p = parseTotpParams('JBSWY3DPEHPK3PXP', '', '', '')
    expect(p).toMatchObject({ period: 30, digits: 6, algorithm: 'SHA1' })
    // "Hello!" followed by 0xDEADBEEF
    expect(p?.secret.toString('hex')).toBe('48656c6c6f21deadbeef')
  })
  it('accepts numeric strings and algorithm spellings', () => {
    expect(parseTotpParams('JBSWY3DPEHPK3PXP', '60', '8', 'sha-256')).toMatchObject({ period: 60, digits: 8, algorithm: 'SHA256' })
  })
  it('reads otpauth URIs', () => {
    expect(parseTotpParams('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=45&digits=7&algorithm=SHA512')).toMatchObject({
      period: 45,
      digits: 7,
      algorithm: 'SHA512',
    })
  })
  it('rejects missing or invalid secrets and HOTP URIs', () => {
    expect(parseTotpParams(undefined)).toBeNull()
    expect(parseTotpParams('')).toBeNull()
    expect(parseTotpParams('not base32!')).toBeNull()
    expect(parseTotpParams('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull()
  })
  it('clamps out-of-range values to defaults', () => {
    expect(parseTotpParams('JBSWY3DPEHPK3PXP', '0', '99', 'MD5')).toMatchObject({ period: 30, digits: 6, algorithm: 'SHA1' })
  })
})
