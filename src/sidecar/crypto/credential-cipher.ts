// SPDX-License-Identifier: AGPL-3.0-only
//
// Application-level encryption of per-browser Psono API key material
// (ADR-0008: device-bound keys).
//
// Each enrolled browser gets a random 256-bit device secret that lives ONLY in
// an HttpOnly cookie. The AES-256-GCM key for that browser's row is
//
//   HKDF-SHA256(ikm = master key, salt = device secret,
//               info = "wikijs-psono-connector/v2|device:<deviceId>|key:<version>")
//
// so decrypting a stored API key needs BOTH the server's master key and the
// browser's cookie. A stolen Wiki.js JWT, a database dump, or even the master
// key alone cannot decrypt anything.
//
// The additional authenticated data binds each ciphertext to its Wiki.js user,
// device, field and key version: rows cannot be swapped between users,
// devices or fields.
//
// Stored format (ASCII): `v2.<keyVersion>.<nonce b64url>.<ciphertext b64url>.<tag b64url>`

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { MasterKey } from '../config'

const FORMAT = 'v2'
const NONCE_BYTES = 12
const TAG_BYTES = 16
export const DEVICE_SECRET_BYTES = 32

export type CredentialField = 'api_key_id' | 'api_key_secret_key'

export interface DeviceContext {
  userId: number
  deviceId: string
  deviceSecret: Buffer
}

export class CredentialDecryptError extends Error {
  override name = 'CredentialDecryptError'
}

function aad(ctx: DeviceContext, field: CredentialField, keyVersion: number): Buffer {
  return Buffer.from(
    `wikijs-psono-connector|${FORMAT}|user:${ctx.userId}|device:${ctx.deviceId}|field:${field}|key:${keyVersion}`,
    'utf8',
  )
}

export class CredentialCipher {
  private readonly keys = new Map<number, Buffer>()

  constructor(private readonly current: MasterKey, previous: MasterKey[] = []) {
    for (const k of [current, ...previous]) {
      if (k.key.length !== 32) throw new Error('Master keys must be 32 bytes')
      this.keys.set(k.version, k.key)
    }
  }

  get currentVersion(): number {
    return this.current.version
  }

  static newDeviceSecret(): Buffer {
    return randomBytes(DEVICE_SECRET_BYTES)
  }

  private deviceKey(masterKey: Buffer, ctx: DeviceContext, keyVersion: number): Buffer {
    if (ctx.deviceSecret.length !== DEVICE_SECRET_BYTES) throw new CredentialDecryptError('Malformed device secret')
    return Buffer.from(
      hkdfSync('sha256', masterKey, ctx.deviceSecret, `wikijs-psono-connector/${FORMAT}|device:${ctx.deviceId}|key:${keyVersion}`, 32),
    )
  }

  encrypt(ctx: DeviceContext, field: CredentialField, plaintext: string): string {
    const version = this.current.version
    const key = this.deviceKey(this.current.key, ctx, version)
    const nonce = randomBytes(NONCE_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
    cipher.setAAD(aad(ctx, field, version))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    key.fill(0)
    return [FORMAT, String(version), nonce.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.')
  }

  /** Returns the plaintext and whether it was encrypted with an older master key. */
  decrypt(ctx: DeviceContext, field: CredentialField, stored: string): { plaintext: string; stale: boolean } {
    const parts = stored.split('.')
    if (parts.length !== 5 || parts[0] !== FORMAT || !/^\d+$/.test(parts[1] ?? '')) {
      throw new CredentialDecryptError('Unrecognised credential format')
    }
    const version = Number(parts[1])
    const master = this.keys.get(version)
    if (!master) throw new CredentialDecryptError(`No master key configured for version ${version}`)
    const nonce = Buffer.from(parts[2] ?? '', 'base64url')
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')
    const tag = Buffer.from(parts[4] ?? '', 'base64url')
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
      throw new CredentialDecryptError('Malformed credential')
    }
    const key = this.deviceKey(master, ctx, version)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
      decipher.setAAD(aad(ctx, field, version))
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
      return { plaintext, stale: version !== this.current.version }
    } catch {
      throw new CredentialDecryptError('Credential authentication failed')
    } finally {
      key.fill(0)
    }
  }
}
