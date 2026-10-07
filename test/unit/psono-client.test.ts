// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { PsonoClient, PsonoError } from '../../src/sidecar/psono/client'
import { mapSecret } from '../../src/sidecar/psono/secret-mapper'
import { encryptSecretResponse, makeApiKey, stubFetch, WEBSITE_SECRET } from '../helpers/psono-fixtures'

const SECRET_ID = 'd060134e-cebc-4aa7-ba82-97c64070aff1'
const API = 'https://psono.example.com/server'

function client(fetchImpl: typeof fetch) {
  return new PsonoClient({ apiBaseUrl: API, timeoutMs: 1000, fetch: fetchImpl })
}

async function kind(p: Promise<unknown>) {
  try {
    await p
    return 'resolved'
  } catch (err) {
    return err instanceof PsonoError ? err.kind : `unexpected: ${String(err)}`
  }
}

describe('PsonoClient.readSecret', () => {
  it('decrypts locally and never sends the API key secret key', async () => {
    const key = makeApiKey()
    const { fn, calls } = stubFetch(200, encryptSecretResponse(WEBSITE_SECRET, key.apiKeySecretKey))
    expect(await client(fn).readSecret(key, SECRET_ID)).toEqual(WEBSITE_SECRET)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${API}/api-key-access/secret/`)
    expect(calls[0]!.init.redirect).toBe('manual')
    const sent = JSON.parse(String(calls[0]!.init.body))
    expect(sent).toEqual({ api_key_id: key.apiKeyId, secret_id: SECRET_ID })
    expect(String(calls[0]!.init.body)).not.toContain(key.apiKeySecretKey)
  })

  it('maps NO_PERMISSION_OR_NOT_EXIST to forbidden', async () => {
    const { fn } = stubFetch(400, { non_field_errors: ['NO_PERMISSION_OR_NOT_EXIST'] })
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('forbidden')
  })

  it('reports a wrong API key secret key as invalid_credentials', async () => {
    const { fn } = stubFetch(200, encryptSecretResponse(WEBSITE_SECRET, makeApiKey().apiKeySecretKey))
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('invalid_credentials')
  })

  it.each([
    [500, 'unavailable'],
    [503, 'unavailable'],
    [429, 'unavailable'],
    [401, 'error'],
    [302, 'error'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const { fn } = stubFetch(status, {})
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe(expected)
  })

  it('maps network failures to unavailable', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('unavailable')
  })

  it('rejects oversized responses', async () => {
    const { fn } = stubFetch(200, 'x'.repeat(1024 * 1024 + 1))
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('error')
  })

  it('rejects malformed responses', async () => {
    for (const body of ['not json', { data: 'zz' }, { data: 'gg', data_nonce: '00', secret_key: '00', secret_key_nonce: '00' }]) {
      const { fn } = stubFetch(200, body)
      expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('error')
    }
  })

  it('validates identifiers before any network call', async () => {
    const { fn, calls } = stubFetch(200, {})
    expect(await kind(client(fn).readSecret(makeApiKey(), '../../admin'))).toBe('error')
    expect(calls).toHaveLength(0)
  })
})

describe('mapSecret', () => {
  it('keeps only allow-listed fields and hides password and TOTP seed', () => {
    const mapped = mapSecret(WEBSITE_SECRET)
    expect(mapped.summary).toEqual({
      type: 'website_password',
      title: 'Test DB',
      url: 'https://db.example.com/login',
      username: 'svc-test',
      notes: 'VPN required',
      hasPassword: true,
      hasOtp: true,
    })
    expect(JSON.stringify(mapped.summary)).not.toMatch(/must-never-leak|correct horse|JBSWY3DP/)
    expect(mapped.password).toBe('correct horse battery staple')
    expect(mapped.totp?.period).toBe(30)
  })

  it('drops non-http URLs', () => {
    const mapped = mapSecret({ ...WEBSITE_SECRET, website_password_url: 'javascript:alert(1)' })
    expect(mapped.summary.url).toBeUndefined()
  })

  it('handles application passwords, TOTP entries, bookmarks and notes', () => {
    expect(mapSecret({ application_password_title: 'App', application_password_username: 'u', application_password_password: 'p' }).summary).toMatchObject({
      type: 'application_password',
      username: 'u',
      hasPassword: true,
      hasOtp: false,
    })
    expect(mapSecret({ totp_title: 'OTP', totp_code: 'JBSWY3DPEHPK3PXP' }).summary).toMatchObject({ type: 'totp', hasOtp: true, hasPassword: false })
    expect(mapSecret({ bookmark_title: 'B', bookmark_url: 'https://x.example' }).summary).toMatchObject({ type: 'bookmark', url: 'https://x.example/' })
    expect(mapSecret({ note_title: 'N', note_notes: 'text' }).summary).toMatchObject({ type: 'note', notes: 'text' })
  })

  it('exposes only the title of unsupported types', () => {
    const mapped = mapSecret({ credit_card_title: 'Card', credit_card_number: '4111111111111111', credit_card_cvc: '123' })
    expect(mapped).toEqual({ summary: { type: 'unsupported', title: 'Card', hasPassword: false, hasOtp: false } })
  })

  it('survives garbage', () => {
    for (const bad of [null, 42, 'x', [], {}]) {
      expect(mapSecret(bad).summary.type).toBe('unsupported')
    }
  })
})

describe('Psono 400 body variants (observed on release 7.4.5)', () => {
  it.each([
    ['bare text', 'non_field_errors'],
    ['JSON string', '"non_field_errors"'],
    ['JSON object', { non_field_errors: ['NO_PERMISSION_OR_NOT_EXIST'] }],
  ])('%s → forbidden', async (_name, body) => {
    const { fn } = stubFetch(400, body)
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('forbidden')
  })

  it('a field validation error is not a permission denial', async () => {
    const { fn } = stubFetch(400, { secret_id: ['Must be a valid UUID.'] })
    expect(await kind(client(fn).readSecret(makeApiKey(), SECRET_ID))).toBe('error')
  })
})
