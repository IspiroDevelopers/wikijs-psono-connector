// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CredentialCipher, CredentialDecryptError, type DeviceContext } from '../../src/sidecar/crypto/credential-cipher'
import { MemoryCredentialStore } from '../../src/sidecar/db/credential-store'

const k1 = { version: 1, key: randomBytes(32) }
const k2 = { version: 2, key: randomBytes(32) }
const SECRET = 'a'.repeat(64)
const DAY = 86_400_000
const device = (userId = 7): DeviceContext => ({ userId, deviceId: randomUUID(), deviceSecret: CredentialCipher.newDeviceSecret() })

describe('CredentialCipher (device-bound)', () => {
  const cipher = new CredentialCipher(k1)

  it('round-trips with master key + device secret and never stores plaintext', () => {
    const ctx = device()
    const stored = cipher.encrypt(ctx, 'api_key_secret_key', SECRET)
    expect(stored).not.toContain(SECRET)
    expect(stored.startsWith('v2.1.')).toBe(true)
    expect(cipher.decrypt(ctx, 'api_key_secret_key', stored)).toEqual({ plaintext: SECRET, stale: false })
  })

  it('cannot decrypt without the right device secret (master key alone is not enough)', () => {
    const ctx = device()
    const stored = cipher.encrypt(ctx, 'api_key_secret_key', SECRET)
    expect(() => cipher.decrypt({ ...ctx, deviceSecret: CredentialCipher.newDeviceSecret() }, 'api_key_secret_key', stored)).toThrow(CredentialDecryptError)
  })

  it('binds ciphertext to user, device and field', () => {
    const ctx = device()
    const stored = cipher.encrypt(ctx, 'api_key_secret_key', SECRET)
    expect(() => cipher.decrypt({ ...ctx, userId: 8 }, 'api_key_secret_key', stored)).toThrow(CredentialDecryptError)
    expect(() => cipher.decrypt({ ...ctx, deviceId: randomUUID() }, 'api_key_secret_key', stored)).toThrow(CredentialDecryptError)
    expect(() => cipher.decrypt(ctx, 'api_key_id', stored)).toThrow(CredentialDecryptError)
  })

  it('uses a fresh nonce every time and detects tampering', () => {
    const ctx = device()
    expect(cipher.encrypt(ctx, 'api_key_id', 'x')).not.toBe(cipher.encrypt(ctx, 'api_key_id', 'x'))
    const parts = cipher.encrypt(ctx, 'api_key_id', 'hello').split('.')
    const ct = Buffer.from(parts[3]!, 'base64url')
    ct[0] = ct[0]! ^ 1
    parts[3] = ct.toString('base64url')
    expect(() => cipher.decrypt(ctx, 'api_key_id', parts.join('.'))).toThrow(CredentialDecryptError)
  })

  it('fails closed with the wrong master key', () => {
    const ctx = device()
    const stored = cipher.encrypt(ctx, 'api_key_id', 'hello')
    expect(() => new CredentialCipher({ version: 1, key: randomBytes(32) }).decrypt(ctx, 'api_key_id', stored)).toThrow(CredentialDecryptError)
  })

  it('rejects malformed values and old v1 rows', () => {
    const ctx = device()
    for (const bad of ['', 'v2', 'v1.1.a.b.c', 'v2.x.a.b.c', 'v2.9.a.b.c']) {
      expect(() => cipher.decrypt(ctx, 'api_key_id', bad)).toThrow(CredentialDecryptError)
    }
  })
})

describe('device store', () => {
  const creds = { apiKeyId: randomUUID(), apiKeySecretKey: SECRET }

  it('a browser token unlocks only its own row, only for its user', async () => {
    const store = new MemoryCredentialStore(new CredentialCipher(k1))
    const a = await store.enroll(7, creds, 30 * DAY)
    const b = await store.enroll(7, creds, 30 * DAY)
    expect((await store.get(7, a))?.credentials).toEqual(creds)
    expect((await store.get(7, b))?.credentials).toEqual(creds)
    expect(await store.get(8, a)).toBeNull()
    expect(await store.get(7, { deviceId: a.deviceId, deviceSecret: b.deviceSecret })).toBeNull()
    expect(await store.get(7, { deviceId: randomUUID(), deviceSecret: a.deviceSecret })).toBeNull()
  })

  it('the database alone holds nothing decryptable (no device secret stored)', async () => {
    const store = new MemoryCredentialStore(new CredentialCipher(k1))
    const a = await store.enroll(7, creds, 30 * DAY)
    const dump = JSON.stringify([...store.rows.values()])
    expect(dump).not.toContain(a.deviceSecret.toString('base64url'))
    expect(dump).not.toContain(a.deviceSecret.toString('hex'))
    expect(dump).not.toContain(SECRET)
    expect(dump).not.toContain(creds.apiKeyId)
  })

  it('expires at a fixed time after enrollment', async () => {
    let now = new Date('2026-10-07T00:00:00Z')
    const store = new MemoryCredentialStore(new CredentialCipher(k1), () => now)
    const a = await store.enroll(7, creds, 30 * DAY)
    expect(a.expiresAt.toISOString()).toBe('2026-11-06T00:00:00.000Z')
    now = new Date('2026-11-05T23:59:59Z')
    expect(await store.get(7, a)).not.toBeNull()
    now = new Date('2026-11-06T00:00:00Z')
    expect(await store.get(7, a)).toBeNull()
    expect(await store.purgeExpired()).toBe(1)
  })

  it('caps browsers per user, dropping the oldest', async () => {
    const store = new MemoryCredentialStore(new CredentialCipher(k1))
    const first = await store.enroll(7, creds, 1 * DAY)
    for (let i = 0; i < 20; i++) await store.enroll(7, creds, 30 * DAY)
    expect([...store.rows.values()].filter((r) => r.wiki_user_id === 7)).toHaveLength(20)
    expect(await store.get(7, first)).toBeNull()
  })

  it('deletes one browser or all browsers of a user, never another user’s', async () => {
    const store = new MemoryCredentialStore(new CredentialCipher(k1))
    const a = await store.enroll(7, creds, 30 * DAY)
    const b = await store.enroll(7, creds, 30 * DAY)
    const other = await store.enroll(8, creds, 30 * DAY)
    expect(await store.deleteDevice(8, a.deviceId)).toBe(false)
    expect(await store.deleteDevice(7, a.deviceId)).toBe(true)
    expect(await store.get(7, b)).not.toBeNull()
    expect(await store.deleteAllForUser(7)).toBe(1)
    expect(await store.get(8, other)).not.toBeNull()
  })

  it('rotates the master key lazily without moving the expiry', async () => {
    const old = new MemoryCredentialStore(new CredentialCipher(k1))
    const a = await old.enroll(5, creds, 30 * DAY)
    const rotated = new MemoryCredentialStore(new CredentialCipher(k2, [k1]))
    for (const [id, row] of old.rows) rotated.rows.set(id, row)

    expect((await rotated.get(5, a))?.credentials).toEqual(creds)
    const row = rotated.rows.get(a.deviceId)!
    expect(row.secret_key_enc.startsWith('v2.2.')).toBe(true)
    expect(row.expires_at.getTime()).toBe(a.expiresAt.getTime())

    const onlyNew = new MemoryCredentialStore(new CredentialCipher(k2))
    for (const [id, r] of rotated.rows) onlyNew.rows.set(id, r)
    expect((await onlyNew.get(5, a))?.credentials).toEqual(creds)
  })
})
