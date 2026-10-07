// SPDX-License-Identifier: AGPL-3.0-only
//
// End-to-end tests of the sidecar HTTP API with in-memory storage and stubbed
// Wiki.js / Psono backends (real crypto on both sides).
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizePsonoWebBase } from '../../src/shared/psono-reference'
import { CredentialCipher } from '../../src/sidecar/crypto/credential-cipher'
import { MemoryCredentialStore } from '../../src/sidecar/db/credential-store'
import { PsonoClient } from '../../src/sidecar/psono/client'
import { RateLimiter } from '../../src/sidecar/rate-limiter'
import { SecretService } from '../../src/sidecar/secret-service'
import { buildServer, CSRF_HEADER } from '../../src/sidecar/server'
import { WikiIdentity } from '../../src/sidecar/wikijs/identity'
import { ServerIdentity } from '../../src/sidecar/psono/server-identity'
import { encryptSecretResponse, makeApiKey, makeServerIdentity, WEBSITE_SECRET } from '../helpers/psono-fixtures'

const ORIGIN = 'https://wiki.example.com'
const PSONO_WEB = 'https://psono.example.com'
const ALLOWED = 'd060134e-cebc-4aa7-ba82-97c64070aff1'
const DENIED = '1504ff50-f4b9-48a8-ac1d-cbc7251213f3'
const link = (id: string) => `${PSONO_WEB}/index.html#!/datastore/search/${id}`

// Fake JWTs: the token string decides which Wiki.js user GraphQL returns.
const TOKENS: Record<string, number | 'guest' | 'banned'> = {
  'aaa.alice.sig': 7,
  'bbb.bob.sig': 8,
  'ccc.guest.sig': 'guest',
  'ddd.banned.sig': 'banned',
}
const cookie = (token: string) => `other=1; jwt=${token}; theme=dark`

interface Harness {
  /** Make the fake Psono sign /info/ with another key (server replaced / impersonated). */
  replaceServer(): void
  /** Calls to the secret endpoint only (what carries the API key id). */
  readonly secretCalls: number
  /** Simulated browsers: device cookie per Wiki.js session cookie. */
  jar: Map<string, string>
  app: FastifyInstance
  store: MemoryCredentialStore
  logs: string[]
  psonoCalls: number
  aliceKey: ReturnType<typeof makeApiKey>
}

let current: Harness | undefined
afterEach(async () => {
  await current?.app.close()
  current = undefined
})

async function harness(opts: { enabled?: boolean; secureCookies?: boolean; trustedProxies?: string[]; assetsDir?: string; resolvePerMinute?: number } = {}): Promise<Harness> {
  const aliceKey = makeApiKey()
  const logs: string[] = []
  const state = { psonoCalls: 0 }

  const wikiFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const token = String((init?.headers as Record<string, string>).authorization).replace('Bearer ', '')
    const who = TOKENS[token]
    if (typeof who === 'number') return Response.json({ data: { users: { profile: { id: who } } } })
    const message = who === 'banned' ? 'Your account has been disabled.' : 'You must be authenticated to access this resource.'
    return Response.json({ errors: [{ message }], data: { users: { profile: null } } })
  }) as typeof fetch

  const server = makeServerIdentity()
  const state2 = { impostor: null as ReturnType<typeof makeServerIdentity> | null, secretCalls: 0 }
  const psonoFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/info/')) return Response.json((state2.impostor ?? server).infoResponse())
    state.psonoCalls++
    state2.secretCalls++
    const { api_key_id, secret_id } = JSON.parse(String(init?.body))
    if (api_key_id === aliceKey.apiKeyId && secret_id === ALLOWED) {
      return Response.json(encryptSecretResponse(WEBSITE_SECRET, aliceKey.apiKeySecretKey))
    }
    return Response.json({ non_field_errors: ['NO_PERMISSION_OR_NOT_EXIST'] }, { status: 400 })
  }) as typeof fetch

  const store = new MemoryCredentialStore(new CredentialCipher({ version: 1, key: randomBytes(32) }))
  let app: FastifyInstance | undefined
  const secrets = new SecretService({
    enabled: opts.enabled ?? true,
    psonoWeb: normalizePsonoWebBase(PSONO_WEB),
    store,
    psono: new PsonoClient({ apiBaseUrl: `${PSONO_WEB}/server`, timeoutMs: 1000, fetch: psonoFetch }),
    serverIdentity: new ServerIdentity({
      apiBaseUrl: `${PSONO_WEB}/server`,
      verifyKey: server.verifyKey,
      timeoutMs: 1000,
      changedTtlMs: 0,
      okTtlMs: 0,
      fetch: psonoFetch,
    }),
    log: { info: (o, m) => app?.log.info(o, m), warn: (o, m) => app?.log.warn(o, m), error: (o, m) => app?.log.error(o, m) },
  })
  app = await buildServer({
    publicOrigin: ORIGIN,
    trustedProxies: opts.trustedProxies ?? [],
    logLevel: 'info',
    loadMode: 'visible',
    passwordVisibleSeconds: 30,
    sourceUrl: 'https://github.com/example/wikijs-psono-connector',
    deviceTtlMs: 30 * 86_400_000,
    resolvePerMinute: opts.resolvePerMinute ?? 300,
    secureCookies: opts.secureCookies ?? false,
    psonoWeb: normalizePsonoWebBase(PSONO_WEB),
    identity: new WikiIdentity({ wikijsInternalUrl: 'http://wikijs:3000', timeoutMs: 1000, fetch: wikiFetch }),
    store,
    secrets,
    rateLimiter: new RateLimiter(),
    ...(opts.assetsDir ? { assetsDir: opts.assetsDir } : {}),
    logStream: { write: (line) => void logs.push(line) },
  })
  current = {
    replaceServer: () => void (state2.impostor = makeServerIdentity()),
    get secretCalls() {
      return state2.secretCalls
    },
    jar: new Map(),
    app,
    store,
    logs,
    aliceKey,
    get psonoCalls() {
      return state.psonoCalls
    },
  }
  return current
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
async function call(h: Harness, method: Method, path: string, body?: unknown, headers: Record<string, string> = {}) {
  // Each distinct Wiki.js session cookie behaves like its own browser with its own device cookie.
  const session = headers.cookie ?? cookie('aaa.alice.sig')
  const device = h.jar.get(session)
  const res = await h.app.inject({
    method,
    url: `/psono-connector/api${path}`,
    headers: {
      [CSRF_HEADER]: '1',
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
      cookie: device ? `${session}; ${device}` : session,
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  })
  const set = [res.headers['set-cookie'] ?? []].flat().find((c) => String(c).startsWith('psono_connector_device='))
  if (set) {
    const pair = String(set).split(';')[0]!
    if (pair === 'psono_connector_device=') h.jar.delete(session)
    else h.jar.set(session, pair)
  }
  return res
}

async function configureAlice(h: Harness) {
  const res = await call(h, 'PUT', '/me/credentials', h.aliceKey)
  expect(res.statusCode).toBe(200)
}

describe('same-origin / CSRF guard', () => {
  it.each([
    ['missing custom header', { [CSRF_HEADER]: '' }],
    ['foreign Origin', { origin: 'https://evil.example' }],
    ['look-alike Origin', { origin: 'https://wiki.example.com.evil.example' }],
    ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['same-site but not same-origin', { 'sec-fetch-site': 'same-site' }],
  ])('rejects %s', async (_name, headers) => {
    const h = await harness()
    const res = await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) }, headers)
    expect(res.statusCode).toBe(403)
    expect(h.psonoCalls).toBe(0)
  })

  it('rejects POSTs carrying neither Origin nor Sec-Fetch-Site', async () => {
    const h = await harness()
    const res = await h.app.inject({
      method: 'POST',
      url: '/psono-connector/api/secrets/resolve',
      headers: { [CSRF_HEADER]: '1', cookie: cookie('aaa.alice.sig'), 'content-type': 'application/json' },
      payload: JSON.stringify({ url: link(ALLOWED) }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects non-JSON bodies (no simple-request CSRF)', async () => {
    const h = await harness()
    const res = await call(h, 'POST', '/secrets/resolve', undefined, { 'content-type': 'text/plain' })
    expect([400, 415]).toContain(res.statusCode)
  })
})

describe('authentication via Wiki.js', () => {
  it.each([
    ['no cookie', ''],
    ['guest', cookie('ccc.guest.sig')],
    ['deactivated user', cookie('ddd.banned.sig')],
    ['unknown token', cookie('eee.nobody.sig')],
    ['malformed token', 'jwt=not-a-jwt'],
  ])('rejects %s', async (_name, c) => {
    const h = await harness()
    const res = await call(h, 'GET', '/me/status', undefined, { cookie: c })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ status: 'unauthenticated' })
  })
})

describe('per-user request limits', () => {
  it('lets a page with well over 100 credentials load within the default limit', async () => {
    const h = await harness()
    await configureAlice(h)
    const codes: number[] = []
    for (let i = 0; i < 130; i++) codes.push((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).statusCode)
    expect(codes.every((c) => c === 200)).toBe(true)
  })

  it('applies the configured limit per user, and one user does not use up another one’s budget', async () => {
    const h = await harness({ resolvePerMinute: 5 })
    await configureAlice(h)
    const codes: number[] = []
    for (let i = 0; i < 7; i++) codes.push((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).statusCode)
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429])
    const bob = await call(h, 'GET', '/me/status', undefined, { cookie: cookie('bbb.bob.sig') })
    expect(bob.statusCode).toBe(200)
  })
})

describe('abuse limits', () => {
  it('caps failed authentications per IP before they reach Wiki.js', async () => {
    const h = await harness()
    const codes: number[] = []
    for (let i = 0; i < 62; i++) {
      codes.push((await call(h, 'GET', '/me/status', undefined, { cookie: `jwt=x${i}.y.z` })).statusCode)
    }
    expect(codes.slice(0, 60).every((c) => c === 401)).toBe(true)
    expect(codes.slice(60)).toEqual([429, 429])
  })

  it('sets restrictive security headers on API responses', async () => {
    const h = await harness()
    const res = await call(h, 'GET', '/me/status')
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

describe('credentials', () => {
  it('saves, never echoes, and stores only ciphertext', async () => {
    const h = await harness()
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ pluginEnabled: true, credentialsConfigured: false })

    const res = await call(h, 'PUT', '/me/credentials', h.aliceKey)
    expect(res.json()).toMatchObject({ status: 'saved' })
    expect(res.body).not.toContain(h.aliceKey.apiKeySecretKey)

    const row = JSON.stringify([...h.store.rows.values()])
    expect(row).not.toContain(h.aliceKey.apiKeySecretKey)
    expect(row).not.toContain(h.aliceKey.apiKeyId)
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ credentialsConfigured: true })
  })

  it.each([
    [{ apiKeyId: 'x', apiKeySecretKey: 'a'.repeat(64) }],
    [{ apiKeyId: crypto.randomUUID(), apiKeySecretKey: 'z'.repeat(64) }],
    [{ apiKeyId: crypto.randomUUID(), apiKeySecretKey: 'a'.repeat(63) }],
    [{ apiKeyId: crypto.randomUUID(), apiKeySecretKey: 'a'.repeat(64), extra: 1 }],
  ])('rejects invalid credential payloads', async (body) => {
    const h = await harness()
    expect((await call(h, 'PUT', '/me/credentials', body)).statusCode).toBe(400)
  })

  it('deletes', async () => {
    const h = await harness()
    await configureAlice(h)
    expect((await call(h, 'DELETE', '/me/credentials')).json()).toMatchObject({ status: 'deleted' })
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ credentialsConfigured: false })
  })

  it('test endpoint reports success without returning secret fields', async () => {
    const h = await harness()
    await configureAlice(h)
    const res = await call(h, 'POST', '/me/credentials/test', { url: link(ALLOWED) })
    expect(res.json()).toEqual({ status: 'success' })
  })
})

describe('API keys are write-only and always manageable', () => {
  it('there is no route that reads a stored key back', async () => {
    const h = await harness()
    await configureAlice(h)
    for (const method of ['GET', 'POST'] as const) {
      const res = await call(h, method, '/me/credentials', method === 'POST' ? {} : undefined)
      expect([400, 404]).toContain(res.statusCode)
      expect(res.body).not.toContain(h.aliceKey.apiKeySecretKey)
    }
  })

  it('no response ever contains the stored key id or secret key', async () => {
    const h = await harness()
    const bodies: string[] = []
    bodies.push((await call(h, 'PUT', '/me/credentials', h.aliceKey)).body)
    bodies.push((await call(h, 'GET', '/me/status')).body)
    bodies.push((await call(h, 'POST', '/me/credentials/test', { url: link(ALLOWED) })).body)
    for (const path of ['/secrets/resolve', '/secrets/reveal', '/secrets/otp']) {
      bodies.push((await call(h, 'POST', path, { url: link(ALLOWED) })).body)
      bodies.push((await call(h, 'POST', path, { url: link(DENIED) })).body)
    }
    bodies.push((await call(h, 'DELETE', '/me/credentials')).body)
    const all = bodies.join('\n')
    expect(all).not.toContain(h.aliceKey.apiKeySecretKey)
    expect(all).not.toContain(h.aliceKey.apiKeyId)
  })

  it('a key can be replaced and removed right after Psono denied access', async () => {
    const h = await harness()
    await configureAlice(h)
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(DENIED) })).json()).toEqual({ status: 'forbidden' })

    const replacement = makeApiKey()
    expect((await call(h, 'PUT', '/me/credentials', replacement)).json()).toMatchObject({ status: 'saved' })
    // The old key is gone: Alice's previous key no longer resolves anything.
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).json()).toEqual({ status: 'forbidden' })

    expect((await call(h, 'DELETE', '/me/credentials')).json()).toMatchObject({ status: 'deleted' })
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).json()).toEqual({ status: 'not_configured' })
  })

  it('removing a key works even when no key is stored (idempotent)', async () => {
    const h = await harness()
    expect((await call(h, 'DELETE', '/me/credentials')).json()).toMatchObject({ status: 'deleted' })
  })

  it('one user cannot remove another user’s key', async () => {
    const h = await harness()
    await configureAlice(h)
    await call(h, 'DELETE', '/me/credentials', undefined, { cookie: cookie('bbb.bob.sig') })
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ credentialsConfigured: true })
  })
})

describe('device-bound keys (ADR-0008)', () => {
  it('saving sets an HttpOnly, SameSite=Strict, path-scoped device cookie valid for 30 days', async () => {
    const h = await harness()
    const res = await call(h, 'PUT', '/me/credentials', h.aliceKey)
    const set = String([res.headers['set-cookie']].flat()[0])
    expect(set).toMatch(/^psono_connector_device=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43};/)
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Strict')
    expect(set).toContain('Path=/psono-connector/')
    expect(set).toContain('Max-Age=2592000')
    expect(set).not.toContain('Secure')
    expect(new Date(res.json().expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000)
  })

  it('adds Secure when the wiki is served over https', async () => {
    const h = await harness({ secureCookies: true })
    const res = await call(h, 'PUT', '/me/credentials', h.aliceKey)
    expect(String([res.headers['set-cookie']].flat()[0])).toContain('; Secure')
  })

  it('a stolen Wiki.js JWT without the browser cookie reads nothing', async () => {
    const h = await harness()
    await configureAlice(h)
    // Same Wiki.js session token, but from the attacker's machine: no device cookie.
    const res = await h.app.inject({
      method: 'POST',
      url: '/psono-connector/api/secrets/reveal',
      headers: { [CSRF_HEADER]: '1', origin: ORIGIN, 'content-type': 'application/json', cookie: cookie('aaa.alice.sig') },
      payload: JSON.stringify({ url: link(ALLOWED) }),
    })
    expect(res.json()).toEqual({ status: 'not_configured' })
    expect(h.psonoCalls).toBe(0)
  })

  it('a forged device cookie (right id, wrong secret) is treated as no key and cleared', async () => {
    const h = await harness()
    await configureAlice(h)
    const real = h.jar.get(cookie('aaa.alice.sig'))!
    const forged = real.replace(/\.[A-Za-z0-9_-]{43}$/, '.' + Buffer.alloc(32, 1).toString('base64url'))
    const res = await h.app.inject({
      method: 'GET',
      url: '/psono-connector/api/me/status',
      headers: { [CSRF_HEADER]: '1', origin: ORIGIN, cookie: `${cookie('aaa.alice.sig')}; ${forged}` },
    })
    expect(res.json()).toMatchObject({ credentialsConfigured: false })
    expect(String([res.headers['set-cookie']].flat()[0])).toMatch(/^psono_connector_device=; Max-Age=0/)
  })

  it('another user cannot use my device cookie', async () => {
    const h = await harness()
    await configureAlice(h)
    const aliceDevice = h.jar.get(cookie('aaa.alice.sig'))!
    h.jar.set(cookie('bbb.bob.sig'), aliceDevice)
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) }, { cookie: cookie('bbb.bob.sig') })).json()).toEqual({
      status: 'not_configured',
    })
  })

  it('each browser enrolls separately; removing from one browser keeps the others', async () => {
    const h = await harness()
    const laptop = cookie('aaa.alice.sig')
    const phone = `${cookie('aaa.alice.sig')}; ua=phone` // same user, different browser
    await call(h, 'PUT', '/me/credentials', h.aliceKey, { cookie: laptop })
    expect((await call(h, 'GET', '/me/status', undefined, { cookie: phone })).json()).toMatchObject({ credentialsConfigured: false })
    await call(h, 'PUT', '/me/credentials', h.aliceKey, { cookie: phone })
    expect(h.store.rows.size).toBe(2)

    expect((await call(h, 'DELETE', '/me/credentials?scope=browser', undefined, { cookie: phone })).json()).toEqual({ status: 'deleted', scope: 'browser' })
    expect((await call(h, 'GET', '/me/status', undefined, { cookie: phone })).json()).toMatchObject({ credentialsConfigured: false })
    expect((await call(h, 'GET', '/me/status', undefined, { cookie: laptop })).json()).toMatchObject({ credentialsConfigured: true })
  })

  it('"remove from all browsers" revokes every enrollment of the user', async () => {
    const h = await harness()
    const laptop = cookie('aaa.alice.sig')
    const phone = `${cookie('aaa.alice.sig')}; ua=phone`
    await call(h, 'PUT', '/me/credentials', h.aliceKey, { cookie: laptop })
    await call(h, 'PUT', '/me/credentials', h.aliceKey, { cookie: phone })
    await call(h, 'DELETE', '/me/credentials?scope=all', undefined, { cookie: phone })
    expect(h.store.rows.size).toBe(0)
    expect((await call(h, 'GET', '/me/status', undefined, { cookie: laptop })).json()).toMatchObject({ credentialsConfigured: false })
  })

  it('replacing the key on the same browser does not leave the old row behind', async () => {
    const h = await harness()
    await configureAlice(h)
    await call(h, 'PUT', '/me/credentials', makeApiKey())
    expect(h.store.rows.size).toBe(1)
  })

  it('status reports when this browser’s key expires', async () => {
    const h = await harness()
    await configureAlice(h)
    const body = (await call(h, 'GET', '/me/status')).json()
    expect(Date.parse(body.credentialsExpiresAt)).toBeGreaterThan(Date.now() + 29 * 86_400_000)
  })

  it('rejects an unknown delete scope', async () => {
    const h = await harness()
    expect((await call(h, 'DELETE', '/me/credentials?scope=everything')).statusCode).toBe(400)
  })
})

describe('reverse proxy diagnostics', () => {
  it('logs exactly what to set when an untrusted proxy forwards requests', async () => {
    const h = await harness()
    await h.app.inject({ method: 'GET', url: '/psono-connector/healthz', headers: { 'x-forwarded-for': '203.0.113.9' }, remoteAddress: '10.0.0.10' })
    const line = h.logs.find((l) => l.includes('proxy.untrusted'))
    expect(line).toContain('PSONO_CONNECTOR_TRUSTED_PROXIES=10.0.0.10')
  })

  it.each([
    ['a /24 LAN range', ['192.168.1.0/24'], '192.168.1.10', true],
    ['a LAN range given among several entries', ['10.9.0.1', '192.168.1.0/24'], '192.168.1.200', true],
    ['the uniquelocal preset', ['uniquelocal'], '192.168.77.5', true],
    ['an address outside the range', ['192.168.1.0/24'], '192.168.2.10', false],
  ])('trusts a proxy inside %s: %s', async (_name, trusted, proxyIp, shouldTrust) => {
    const h = await harness({ trustedProxies: trusted })
    const res = await h.app.inject({ method: 'GET', url: '/psono-connector/healthz', headers: { 'x-forwarded-for': '203.0.113.9' }, remoteAddress: proxyIp })
    expect(res.statusCode).toBe(200)
    // Trusted: the client address is taken from X-Forwarded-For, so no warning about an untrusted proxy.
    expect(h.logs.some((l) => l.includes('proxy.untrusted'))).toBe(!shouldTrust)
  })

  it('stays quiet and uses the client IP once the proxy is trusted', async () => {
    const h = await harness({ trustedProxies: ['10.0.0.10'] })
    await h.app.inject({ method: 'GET', url: '/psono-connector/healthz', headers: { 'x-forwarded-for': '203.0.113.9' }, remoteAddress: '10.0.0.10' })
    expect(h.logs.some((l) => l.includes('proxy.untrusted'))).toBe(false)
  })
})

describe('Psono server pinning (ADR-0009)', () => {
  it('reports the verified server in the status', async () => {
    const h = await harness()
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ psonoServer: 'ok' })
  })

  it('when the server changes: nothing is sent to it and the card gets a clear status', async () => {
    const h = await harness()
    await configureAlice(h)
    h.replaceServer()
    const before = h.secretCalls

    for (const path of ['/secrets/resolve', '/secrets/reveal', '/secrets/otp', '/me/credentials/test']) {
      const res = await call(h, 'POST', path, { url: link(ALLOWED) })
      expect(res.json()).toEqual({ status: 'server_changed' })
      expect(res.statusCode).toBe(502)
    }
    expect(h.secretCalls).toBe(before) // the API key id never left the sidecar
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ psonoServer: 'changed' })
  })

  it('refuses to accept a new key while the server is not the pinned one', async () => {
    const h = await harness()
    h.replaceServer()
    const res = await call(h, 'PUT', '/me/credentials', makeApiKey())
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ status: 'server_changed' })
    expect(h.store.rows.size).toBe(0)
  })

  it('removing a key still works while the server is not trusted', async () => {
    const h = await harness()
    await configureAlice(h)
    h.replaceServer()
    expect((await call(h, 'DELETE', '/me/credentials?scope=all')).json()).toMatchObject({ status: 'deleted' })
    expect(h.store.rows.size).toBe(0)
  })

  it('"server_changed" takes precedence over "not_configured" (do not invite users to enter a key)', async () => {
    const h = await harness()
    h.replaceServer()
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).json()).toEqual({ status: 'server_changed' })
  })
})

describe('secrets', () => {
  it('resolve returns metadata only — no password, no OTP code — with no-store', async () => {
    const h = await harness()
    await configureAlice(h)
    const res = await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('success')
    expect(body.secret).toMatchObject({ title: 'Test DB', username: 'svc-test', hasPassword: true, hasOtp: true })
    expect(body.otp).toBeUndefined()
    expect(res.body).not.toMatch(/correct horse|must-never-leak|JBSWY3DP/)
    expect(res.headers['cache-control']).toBe('no-store, private')
    expect(res.headers.pragma).toBe('no-cache')
  })

  it('reveal returns the password only on explicit request', async () => {
    const h = await harness()
    await configureAlice(h)
    const res = await call(h, 'POST', '/secrets/reveal', { url: link(ALLOWED) })
    expect(res.json()).toEqual({ status: 'success', password: 'correct horse battery staple' })
  })

  it('otp returns a fresh code', async () => {
    const h = await harness()
    await configureAlice(h)
    const body = (await call(h, 'POST', '/secrets/otp', { url: link(ALLOWED) })).json()
    expect(body.status).toBe('success')
    expect(new Date(body.otp.validUntil).getTime()).toBeGreaterThan(Date.now())
  })

  it('Psono denial is reported as forbidden', async () => {
    const h = await harness()
    await configureAlice(h)
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(DENIED) })).json()).toEqual({ status: 'forbidden' })
  })

  it('a user without credentials is not_configured, never served with another user’s key', async () => {
    const h = await harness()
    await configureAlice(h)
    const res = await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) }, { cookie: cookie('bbb.bob.sig') })
    expect(res.json()).toEqual({ status: 'not_configured' })
    expect(h.psonoCalls).toBe(0)
  })

  it.each([
    'https://psono.example.com.evil.example/index.html#!/datastore/search/d060134e-cebc-4aa7-ba82-97c64070aff1',
    'http://169.254.169.254/latest/meta-data/',
    'https://psono.example.com/link-share-access.html#!/link-share-access/a/b/c',
    'javascript:alert(1)',
  ])('rejects foreign or unsupported URLs without contacting Psono: %s', async (url) => {
    const h = await harness()
    await configureAlice(h)
    expect((await call(h, 'POST', '/secrets/resolve', { url })).json()).toEqual({ status: 'unsupported_reference' })
    expect(h.psonoCalls).toBe(0)
  })

  it('disabled connector answers disabled and never calls Psono', async () => {
    const h = await harness({ enabled: false })
    await configureAlice(h)
    expect((await call(h, 'GET', '/me/status')).json()).toMatchObject({ pluginEnabled: false })
    expect((await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })).json()).toEqual({ status: 'disabled' })
    expect(h.psonoCalls).toBe(0)
  })

  it('rate-limits password reveals per user', async () => {
    const h = await harness()
    await configureAlice(h)
    const codes: number[] = []
    for (let i = 0; i < 31; i++) codes.push((await call(h, 'POST', '/secrets/reveal', { url: link(ALLOWED) })).statusCode)
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true)
    expect(codes[30]).toBe(429)
  })
})

describe('logging', () => {
  it('never writes keys, secrets, cookies or OTP codes to the log', async () => {
    const h = await harness()
    await configureAlice(h)
    await call(h, 'POST', '/secrets/resolve', { url: link(ALLOWED) })
    const otp = (await call(h, 'POST', '/secrets/otp', { url: link(ALLOWED) })).json().otp.code as string
    await call(h, 'POST', '/secrets/reveal', { url: link(ALLOWED) })
    await call(h, 'POST', '/secrets/resolve', { url: link(DENIED) })

    const all = h.logs.join('\n')
    expect(h.logs.length).toBeGreaterThan(0)
    for (const needle of [
      h.aliceKey.apiKeySecretKey,
      h.aliceKey.apiKeyId,
      'correct horse',
      'svc-test',
      'VPN required',
      'must-never-leak',
      'JBSWY3DP',
      'aaa.alice.sig',
      ALLOWED,
      DENIED,
      `"${otp}"`,
    ]) {
      expect(all).not.toContain(needle)
    }
    expect(all).toContain('"event":"secret.reveal"')
  })
})

describe('static assets', () => {
  const assets = () => {
    const dir = mkdtempSync(join(tmpdir(), 'psc-assets-'))
    writeFileSync(join(dir, 'client.js'), '/* bundle */')
    writeFileSync(join(dir, 'settings.html'), '<!doctype html><title>settings</title>')
    return dir
  }

  it('serves the bundle and the settings page with their security headers', async () => {
    const h = await harness({ assetsDir: assets() })
    const js = await h.app.inject({ method: 'GET', url: '/psono-connector/client.js' })
    expect(js.statusCode).toBe(200)
    expect(js.headers['content-type']).toContain('text/javascript')
    expect(js.headers['cache-control']).toBe('no-store, private')
    const page = await h.app.inject({ method: 'GET', url: '/psono-connector/settings' })
    expect(page.headers['content-security-policy']).toContain("script-src 'self'")
    expect(page.body).toContain('<title>settings</title>')
  })

  it('serves from memory: removing the files after start changes nothing', async () => {
    const dir = assets()
    const h = await harness({ assetsDir: dir })
    const { rmSync } = await import('node:fs')
    rmSync(dir, { recursive: true, force: true })
    expect((await h.app.inject({ method: 'GET', url: '/psono-connector/client.js' })).statusCode).toBe(200)
  })

  it('fails at start when the build output is missing', async () => {
    await expect(harness({ assetsDir: join(tmpdir(), 'psc-does-not-exist') })).rejects.toThrow()
  })
})

describe('source link', () => {
  it('redirects /psono-connector/source to the configured source URL without authentication', async () => {
    const h = await harness()
    const res = await h.app.inject({ method: 'GET', url: '/psono-connector/source' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://github.com/example/wikijs-psono-connector')
  })
})

describe('misc', () => {
  it('healthz needs no auth', async () => {
    const h = await harness()
    const res = await h.app.inject({ method: 'GET', url: '/psono-connector/healthz' })
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('unknown routes are 404 JSON', async () => {
    const h = await harness()
    const res = await h.app.inject({ method: 'GET', url: '/psono-connector/nope' })
    expect(res.statusCode).toBe(404)
  })
})
