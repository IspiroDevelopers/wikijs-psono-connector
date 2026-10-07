// SPDX-License-Identifier: AGPL-3.0-only
//
// Psono session-less API key access with LOCAL decryption (ADR-0004):
//   POST {apiBase}/api-key-access/secret/  { api_key_id, secret_id }
//   secret_key = SecretBox(api_key_secret_key).open(secret_key, secret_key_nonce)   -> 64 hex chars
//   data       = SecretBox(hex(secret_key)).open(data, data_nonce)                  -> UTF-8 JSON
// The api_key_secret_key is never sent to Psono (that would be remote decryption).
// Only the admin-configured API base URL is ever contacted (no SSRF surface).

import nacl from 'tweetnacl'

export interface PsonoCredentials {
  apiKeyId: string
  apiKeySecretKey: string
}

export type PsonoErrorKind =
  /** Psono says no: secret unknown, not linked to the key, key inactive, or user lost access. */
  | 'forbidden'
  /** The API key secret key does not decrypt the response. */
  | 'invalid_credentials'
  | 'unavailable'
  | 'error'

export class PsonoError extends Error {
  override name = 'PsonoError'
  constructor(readonly kind: PsonoErrorKind, message: string) {
    super(message)
  }
}

export interface PsonoClientOptions {
  apiBaseUrl: string
  timeoutMs: number
  /** Injected in tests. */
  fetch?: typeof fetch
}

const MAX_RESPONSE_BYTES = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^[0-9a-f]*$/i

function hexToBytes(hex: string, expectedLength?: number): Uint8Array {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) throw new PsonoError('error', 'Malformed hex in Psono response')
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'))
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new PsonoError('error', 'Unexpected length in Psono response')
  }
  return bytes
}

export async function readLimited(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new PsonoError('error', 'Psono response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

interface EncryptedSecret {
  data: string
  data_nonce: string
  secret_key: string
  secret_key_nonce: string
}

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return ['data', 'data_nonce', 'secret_key', 'secret_key_nonce'].every((k) => typeof v[k] === 'string')
}

/**
 * psono-server raises NO_PERMISSION_OR_NOT_EXIST as a non-field validation
 * error. Source builds return `{"non_field_errors": ["NO_PERMISSION_OR_NOT_EXIST"]}`;
 * release 7.4.5 answers with the bare text `non_field_errors`. Since the
 * connector never sends `api_key_secret_key`, the only possible non-field
 * error is "no permission or does not exist". Field errors (e.g. a malformed
 * UUID) name the field instead and are not treated as a denial.
 */
function isNoPermission(body: string): boolean {
  if (body.includes('NO_PERMISSION_OR_NOT_EXIST')) return true
  const trimmed = body.trim()
  if (/^"?non_field_errors"?$/.test(trimmed)) return true
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 1 && 'non_field_errors' in parsed
  } catch {
    return false
  }
}

export function decryptSecret(encrypted: EncryptedSecret, apiKeySecretKey: string): unknown {
  const apiKey = hexToBytes(apiKeySecretKey, nacl.secretbox.keyLength)
  const secretKeyHex = nacl.secretbox.open(
    hexToBytes(encrypted.secret_key),
    hexToBytes(encrypted.secret_key_nonce, nacl.secretbox.nonceLength),
    apiKey,
  )
  if (!secretKeyHex) throw new PsonoError('invalid_credentials', 'API key secret key does not decrypt the secret key')
  const secretKey = hexToBytes(Buffer.from(secretKeyHex).toString('utf8'), nacl.secretbox.keyLength)
  const data = nacl.secretbox.open(hexToBytes(encrypted.data), hexToBytes(encrypted.data_nonce, nacl.secretbox.nonceLength), secretKey)
  secretKey.fill(0)
  apiKey.fill(0)
  if (!data) throw new PsonoError('error', 'Secret data could not be decrypted')
  try {
    return JSON.parse(Buffer.from(data).toString('utf8'))
  } catch {
    throw new PsonoError('error', 'Secret data is not JSON')
  } finally {
    data.fill(0)
  }
}

export class PsonoClient {
  private readonly endpoint: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: PsonoClientOptions) {
    this.endpoint = `${options.apiBaseUrl}/api-key-access/secret/`
    this.fetchImpl = options.fetch ?? fetch
  }

  /** Fetches and locally decrypts one secret. Returns the decrypted JSON object. */
  async readSecret(credentials: PsonoCredentials, secretId: string, signal?: AbortSignal): Promise<unknown> {
    if (!UUID.test(secretId) || !UUID.test(credentials.apiKeyId)) {
      throw new PsonoError('error', 'Invalid identifier')
    }
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ api_key_id: credentials.apiKeyId, secret_id: secretId }),
        redirect: 'manual',
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      })
    } catch {
      throw new PsonoError('unavailable', 'Psono server not reachable')
    }

    if (response.status >= 300 && response.status < 400) {
      throw new PsonoError('error', 'Psono server answered with a redirect, which is not followed')
    }
    let body: string
    try {
      body = await readLimited(response)
    } catch (err) {
      if (err instanceof PsonoError) throw err
      throw new PsonoError('unavailable', 'Psono response interrupted')
    }

    if (response.status === 400 && isNoPermission(body)) {
      throw new PsonoError('forbidden', 'No permission or secret does not exist')
    }
    if (response.status >= 500 || response.status === 429) {
      throw new PsonoError('unavailable', `Psono server error ${response.status}`)
    }
    if (response.status !== 200) {
      throw new PsonoError('error', `Unexpected Psono status ${response.status}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new PsonoError('error', 'Psono response is not JSON')
    }
    if (!isEncryptedSecret(parsed)) throw new PsonoError('error', 'Unexpected Psono response shape')
    return decryptSecret(parsed, credentials.apiKeySecretKey)
  }
}
