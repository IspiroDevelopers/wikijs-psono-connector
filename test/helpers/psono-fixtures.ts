// SPDX-License-Identifier: AGPL-3.0-only
//
// Produces responses shaped exactly like psono-server's
// /api-key-access/secret/ (local decryption mode), encrypted the same way, so
// the client can be tested without a server. All values are random test data.

import { randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

export function makeApiKey() {
  return { apiKeyId: crypto.randomUUID(), apiKeySecretKey: hex(randomBytes(32)) }
}

export function encryptSecretResponse(data: unknown, apiKeySecretKey: string) {
  // Psono stores the per-secret key as a hex string and encrypts that string.
  const secretKeyHex = hex(randomBytes(32))
  const skNonce = randomBytes(24)
  const encSecretKey = nacl.secretbox(Buffer.from(secretKeyHex, 'utf8'), skNonce, Buffer.from(apiKeySecretKey, 'hex'))
  const dataNonce = randomBytes(24)
  const encData = nacl.secretbox(Buffer.from(JSON.stringify(data), 'utf8'), dataNonce, Buffer.from(secretKeyHex, 'hex'))
  return {
    data: hex(encData),
    data_nonce: hex(dataNonce),
    secret_key: hex(encSecretKey),
    secret_key_nonce: hex(skNonce),
    read_count: 1,
    write_date: '2026-10-07T00:00:00Z',
  }
}

export const WEBSITE_SECRET = {
  website_password_title: 'Test DB',
  website_password_url: 'https://db.example.com/login',
  website_password_username: 'svc-test',
  website_password_password: 'correct horse battery staple',
  website_password_notes: 'VPN required',
  website_password_totp_code: 'JBSWY3DPEHPK3PXP',
  website_password_totp_period: 30,
  website_password_totp_digits: 6,
  website_password_totp_algorithm: 'SHA1',
  website_password_url_filter: 'db.example.com',
  website_password_auto_submit: false,
  website_password_allow_http: false,
  custom_fields: [{ name: 'root', value: 'must-never-leak' }],
  tags: ['test'],
}

/** A fetch stub that returns `body` with `status` and records calls. */
export function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fn, calls }
}

/** A fake Psono signing identity producing /info/ documents exactly like psono-server. */
export function makeServerIdentity() {
  const pair = nacl.sign.keyPair()
  const verifyKey = hex(pair.publicKey)
  const infoResponse = (info: Record<string, unknown> = { version: '7.4.5', api: 1, public_key: hex(randomBytes(32)) }, signWith = pair) => {
    const infoString = JSON.stringify(info)
    const signature = nacl.sign.detached(Buffer.from(infoString, 'utf8'), signWith.secretKey)
    return { info: infoString, signature: hex(signature), verify_key: hex(signWith.publicKey) }
  }
  return { verifyKey, pair, infoResponse }
}
