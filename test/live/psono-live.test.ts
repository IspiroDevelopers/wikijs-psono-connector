// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs against a real, throwaway Psono server. Skipped unless the PSONO_TEST_*
// variables are set (see docs/development.md). Never point this at a
// production Psono: it needs API keys in environment variables.
import { describe, expect, it } from 'vitest'
import { PsonoClient, PsonoError } from '../../src/sidecar/psono/client'
import { ServerIdentity } from '../../src/sidecar/psono/server-identity'
import { mapSecret } from '../../src/sidecar/psono/secret-mapper'

const env = process.env
const enabled = Boolean(env.PSONO_TEST_SERVER_URL && env.PSONO_TEST_ALICE_KEY_ID)

describe.skipIf(!enabled)('live Psono server', () => {
  // describe.skipIf still evaluates this body when skipped: no non-null assumptions here.
  const client = new PsonoClient({ apiBaseUrl: (env.PSONO_TEST_SERVER_URL ?? '').replace(/\/+$/, ''), timeoutMs: 8000 })
  const alice = { apiKeyId: env.PSONO_TEST_ALICE_KEY_ID!, apiKeySecretKey: env.PSONO_TEST_ALICE_SECRET_KEY! }
  const bob = { apiKeyId: env.PSONO_TEST_BOB_KEY_ID!, apiKeySecretKey: env.PSONO_TEST_BOB_SECRET_KEY! }
  const A = env.PSONO_TEST_SECRET_A!
  const B = env.PSONO_TEST_SECRET_B!
  const C = env.PSONO_TEST_SECRET_C!

  async function outcome(creds: typeof alice, id: string) {
    try {
      return mapSecret(await client.readSecret(creds, id))
    } catch (err) {
      if (err instanceof PsonoError) return err.kind
      throw err
    }
  }

  it('decrypts a linked secret locally and computes its TOTP', async () => {
    const result = await outcome(alice, B)
    expect(typeof result).toBe('object')
    if (typeof result === 'string') return
    expect(result.summary.type).toBe('website_password')
    expect(result.summary.title.length).toBeGreaterThan(0)
    expect(result.summary.hasOtp).toBe(true)
    expect(result.totp?.period).toBeGreaterThan(0)
  })

  it('is denied for a secret not linked to the key', async () => {
    expect(await outcome(alice, C)).toBe('forbidden')
  })

  it('is denied for a nonexistent secret (indistinguishable from no permission)', async () => {
    expect(await outcome(alice, '00000000-0000-4000-8000-000000000000')).toBe('forbidden')
  })

  it('a second user with their own key reads the shared secret', async () => {
    const result = await outcome(bob, B)
    expect(typeof result).toBe('object')
  })

  it('a wrong API key secret key is reported as invalid_credentials', async () => {
    expect(await outcome({ apiKeyId: alice.apiKeyId, apiKeySecretKey: 'ab'.repeat(32) }, B)).toBe('invalid_credentials')
  })

  it('an unknown API key id is denied', async () => {
    expect(await outcome({ apiKeyId: crypto.randomUUID(), apiKeySecretKey: alice.apiKeySecretKey }, B)).toBe('forbidden')
  })

  describe('server pinning', () => {
    const identity = (verifyKey: string) =>
      new ServerIdentity({ apiBaseUrl: (env.PSONO_TEST_SERVER_URL ?? '').replace(/\/+$/, ''), verifyKey, timeoutMs: 8000 })

    it('accepts the real server with its real verify key', async () => {
      expect(await identity(env.PSONO_TEST_SERVER_VERIFY_KEY ?? '').check()).toEqual({ ok: true })
    })

    it('rejects the real server when the pin is a different key', async () => {
      const result = await identity('ab'.repeat(32)).check()
      expect(result).toMatchObject({ ok: false, reason: 'changed', seenKey: env.PSONO_TEST_SERVER_VERIFY_KEY })
    })
  })
})
