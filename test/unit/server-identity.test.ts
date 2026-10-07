// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { fetchServerInfo, ServerIdentity } from '../../src/sidecar/psono/server-identity'
import { makeServerIdentity, stubFetch } from '../helpers/psono-fixtures'
import nacl from 'tweetnacl'

const API = 'https://psono.example.com/server'

function identity(fetchImpl: typeof fetch, verifyKey: string, extra: Partial<ConstructorParameters<typeof ServerIdentity>[0]> = {}) {
  return new ServerIdentity({ apiBaseUrl: API, verifyKey, timeoutMs: 1000, fetch: fetchImpl, ...extra })
}

describe('ServerIdentity (pinning)', () => {
  it('accepts the pinned server and calls /info/ without following redirects', async () => {
    const real = makeServerIdentity()
    const { fn, calls } = stubFetch(200, real.infoResponse())
    expect(await identity(fn, real.verifyKey).check()).toEqual({ ok: true })
    expect(calls[0]!.url).toBe(`${API}/info/`)
    expect(calls[0]!.init.redirect).toBe('manual')
    expect(calls[0]!.init.method).toBe('GET')
  })

  it('accepts an upper-case pin', async () => {
    const real = makeServerIdentity()
    const { fn } = stubFetch(200, real.infoResponse())
    expect(await identity(fn, real.verifyKey.toUpperCase()).check()).toEqual({ ok: true })
  })

  it('rejects a different server that signs validly with its own key', async () => {
    const real = makeServerIdentity()
    const impostor = makeServerIdentity()
    const { fn } = stubFetch(200, impostor.infoResponse())
    const result = await identity(fn, real.verifyKey).check()
    expect(result).toEqual({ ok: false, reason: 'changed', seenKey: impostor.verifyKey })
  })

  it('rejects an impostor that claims the pinned key but cannot sign with it', async () => {
    const real = makeServerIdentity()
    const impostor = nacl.sign.keyPair()
    const doc = real.infoResponse(undefined, impostor) // signed by impostor…
    doc.verify_key = real.verifyKey // …but presenting the pinned verify key
    const { fn } = stubFetch(200, doc)
    expect((await identity(fn, real.verifyKey).check()).ok).toBe(false)
  })

  it('rejects tampered info content', async () => {
    const real = makeServerIdentity()
    const doc = real.infoResponse()
    doc.info = doc.info.replace('7.4.5', '9.9.9')
    const { fn } = stubFetch(200, doc)
    expect(await identity(fn, real.verifyKey).check()).toMatchObject({ ok: false, reason: 'changed' })
  })

  it.each([
    ['an HTML page', 200, '<html>Welcome to my phishing site</html>'],
    ['a JSON document of another shape', 200, { hello: 'world' }],
    ['a 404 (not a Psono server)', 404, {}],
    ['a 401', 401, {}],
    ['a redirect', 302, {}],
    ['malformed hex', 200, { info: '{}', signature: 'zz', verify_key: 'zz' }],
  ])('treats %s as an identity change', async (_name, status, body) => {
    const { fn } = stubFetch(status, body)
    expect(await identity(fn, makeServerIdentity().verifyKey).check()).toMatchObject({ ok: false, reason: 'changed' })
  })

  it.each([[500], [502], [503], [429]])('treats HTTP %i as unavailable, not as an identity change', async (status) => {
    const { fn } = stubFetch(status, {})
    expect(await identity(fn, makeServerIdentity().verifyKey).check()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('treats network errors as unavailable', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    expect(await identity(fn, makeServerIdentity().verifyKey).check()).toEqual({ ok: false, reason: 'unavailable' })
  })

  it('caches a good verdict, then re-checks after the TTL', async () => {
    const real = makeServerIdentity()
    const { fn, calls } = stubFetch(200, real.infoResponse())
    let now = 1_000_000
    const id = identity(fn, real.verifyKey, { now: () => now, okTtlMs: 60_000 })
    await id.check()
    await id.check()
    expect(calls).toHaveLength(1)
    now += 60_001
    await id.check()
    expect(calls).toHaveLength(2)
  })

  it('shares one network check between concurrent callers', async () => {
    const real = makeServerIdentity()
    const { fn, calls } = stubFetch(200, real.infoResponse())
    const id = identity(fn, real.verifyKey)
    await Promise.all([id.check(), id.check(), id.check()])
    expect(calls).toHaveLength(1)
  })

  it('notices a change on re-check and reports each state transition once', async () => {
    const real = makeServerIdentity()
    const impostor = makeServerIdentity()
    let current: unknown = real.infoResponse()
    const fn = (async () => Response.json(current)) as typeof fetch
    let now = 0
    const events: string[] = []
    const id = identity(fn, real.verifyKey, {
      now: () => now,
      okTtlMs: 1000,
      changedTtlMs: 1000,
      onChange: (c) => events.push(c.ok ? 'ok' : c.reason),
    })
    await id.check()
    now += 2000
    current = impostor.infoResponse()
    expect((await id.check()).ok).toBe(false)
    now += 2000
    await id.check()
    now += 2000
    current = real.infoResponse()
    expect((await id.check()).ok).toBe(true)
    expect(events).toEqual(['ok', 'changed', 'ok'])
  })

  it('rejects an invalid pin at construction', () => {
    expect(() => identity(stubFetch(200, {}).fn, 'nothex')).toThrow()
  })
})

describe('fetchServerInfo', () => {
  it('returns the verified signing key', async () => {
    const real = makeServerIdentity()
    const { fn } = stubFetch(200, real.infoResponse())
    expect(await fetchServerInfo(API, 1000, fn)).toEqual({ verifyKey: real.verifyKey })
  })
})
