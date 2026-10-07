// SPDX-License-Identifier: AGPL-3.0-only
//
// RFC 6238 TOTP on top of node:crypto HMAC. Only glue code: the primitive is
// the platform HMAC, and the implementation is checked against the RFC 6238
// Appendix B test vectors.

import { createHmac } from 'node:crypto'

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export interface TotpParams {
  secret: Buffer
  period: number
  digits: number
  algorithm: TotpAlgorithm
}

export interface TotpCode {
  code: string
  validUntil: Date
  periodSeconds: number
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, case-insensitive, ignoring spaces, dashes and padding. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (clean.length === 0 || !/^[A-Z2-7]+$/.test(clean)) throw new Error('Invalid base32')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char)
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function normalizeAlgorithm(value: unknown): TotpAlgorithm {
  const v = typeof value === 'string' ? value.toUpperCase().replace('-', '') : 'SHA1'
  return v === 'SHA256' || v === 'SHA512' ? v : 'SHA1'
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/**
 * Builds TOTP parameters from the fields Psono stores. `code` may be a bare
 * base32 secret or an `otpauth://totp/...` URI; URI parameters take precedence
 * over the separate fields only when those are absent.
 */
export function parseTotpParams(code: unknown, period?: unknown, digits?: unknown, algorithm?: unknown): TotpParams | null {
  if (typeof code !== 'string' || code.trim() === '') return null
  let secretText = code.trim()
  let uriPeriod: string | null = null
  let uriDigits: string | null = null
  let uriAlgorithm: string | null = null
  if (/^otpauth:\/\//i.test(secretText)) {
    try {
      const url = new URL(secretText)
      if (url.host.toLowerCase() !== 'totp') return null
      secretText = url.searchParams.get('secret') ?? ''
      uriPeriod = url.searchParams.get('period')
      uriDigits = url.searchParams.get('digits')
      uriAlgorithm = url.searchParams.get('algorithm')
    } catch {
      return null
    }
  }
  let secret: Buffer
  try {
    secret = base32Decode(secretText)
  } catch {
    return null
  }
  return {
    secret,
    period: boundedInt(period ?? uriPeriod, 30, 1, 3600),
    digits: boundedInt(digits ?? uriDigits, 6, 6, 10),
    algorithm: normalizeAlgorithm(algorithm ?? uriAlgorithm),
  }
}

export function totpAt(params: TotpParams, now: Date): TotpCode {
  const seconds = Math.floor(now.getTime() / 1000)
  const counter = Math.floor(seconds / params.period)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac(params.algorithm.toLowerCase(), params.secret).update(msg).digest()
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff
  const code = (binary % 10 ** params.digits).toString().padStart(params.digits, '0')
  return {
    code,
    validUntil: new Date((counter + 1) * params.period * 1000),
    periodSeconds: params.period,
  }
}
