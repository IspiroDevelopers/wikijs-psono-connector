// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  normalizePsonoWebBase,
  parsePsonoReference,
  PsonoConfigError,
  psonoSecretUrl,
} from '../../src/shared/psono-reference'

const ID = '0b6c9a3e-1f2d-4c5b-8a7e-9d0c1b2a3f4e'
const base = normalizePsonoWebBase('https://psono.example.com')
const parse = (href: string) => parsePsonoReference(href, base)

describe('normalizePsonoWebBase', () => {
  it.each([
    ['https://psono.example.com', 'https://psono.example.com', '/'],
    ['https://psono.example.com/', 'https://psono.example.com', '/'],
    ['https://psono.example.com/index.html', 'https://psono.example.com', '/'],
    ['HTTPS://Psono.Example.COM:443/psono', 'https://psono.example.com', '/psono/'],
    ['https://example.com/psono/index.html', 'https://example.com', '/psono/'],
    ['https://psono.example.com:8443/', 'https://psono.example.com:8443', '/'],
    ['  https://psono.example.com  ', 'https://psono.example.com', '/'],
  ])('%s', (input, origin, basePath) => {
    expect(normalizePsonoWebBase(input)).toEqual({ origin, basePath, allowHttp: false })
  })

  it.each([
    '',
    'psono.example.com',
    'http://psono.example.com',
    'ftp://psono.example.com',
    'javascript:alert(1)',
    'https://user:pass@psono.example.com',
    'https://psono.example.com/?a=1',
    'https://psono.example.com/#!/x',
    'https://psono.example.com/p%61th/',
    'https://psono.exa mple.com',
  ])('rejects %j', (input) => {
    expect(() => normalizePsonoWebBase(input)).toThrow(PsonoConfigError)
  })

  it('accepts http only when explicitly allowed', () => {
    expect(normalizePsonoWebBase('http://localhost:10100', { allowHttp: true })).toEqual({
      origin: 'http://localhost:10100',
      basePath: '/',
      allowHttp: true,
    })
  })
})

describe('parsePsonoReference — supported links', () => {
  it.each([
    [`https://psono.example.com/index.html#!/datastore/search/${ID}`, 'datastore-search'],
    [`https://psono.example.com/#!/datastore/search/${ID}`, 'datastore-search'],
    [`https://psono.example.com/index.html#!/datastore/edit/website_password/${ID}`, 'datastore-edit'],
    [`https://psono.example.com/open-secret.html#!/secret/application_password/${ID}`, 'open-secret'],
    [`https://PSONO.example.com:443/index.html#!/datastore/search/${ID}`, 'datastore-search'],
  ])('%s', (href, route) => {
    expect(parse(href)).toEqual({ secretId: ID, route })
  })

  it('normalises the secret id to lower case', () => {
    expect(parse(`https://psono.example.com/index.html#!/datastore/search/${ID.toUpperCase()}`)?.secretId).toBe(ID)
  })

  it('honours a sub-path base', () => {
    const sub = normalizePsonoWebBase('https://example.com/psono/')
    expect(parsePsonoReference(`https://example.com/psono/index.html#!/datastore/search/${ID}`, sub)?.secretId).toBe(ID)
    expect(parsePsonoReference(`https://example.com/index.html#!/datastore/search/${ID}`, sub)).toBeNull()
    expect(parsePsonoReference(`https://example.com/psonox/index.html#!/datastore/search/${ID}`, sub)).toBeNull()
  })
})

describe('parsePsonoReference — rejected links', () => {
  it.each([
    // host confusion
    [`https://psono.example.com.attacker.example/index.html#!/datastore/search/${ID}`],
    [`https://evil.example/?next=https://psono.example.com/index.html#!/datastore/search/${ID}`],
    [`https://sub.psono.example.com/index.html#!/datastore/search/${ID}`],
    [`https://example.com/index.html#!/datastore/search/${ID}`],
    [`https://psono.example.com:8443/index.html#!/datastore/search/${ID}`],
    [`https://psono.example.com@evil.example/index.html#!/datastore/search/${ID}`],
    // credentials
    [`https://username:password@psono.example.com/index.html#!/datastore/search/${ID}`],
    [`https://user@psono.example.com/index.html#!/datastore/search/${ID}`],
    // protocol
    [`http://psono.example.com/index.html#!/datastore/search/${ID}`],
    [`javascript://psono.example.com/%0aalert(1)`],
    [`//psono.example.com/index.html#!/datastore/search/${ID}`],
    // link shares carry decryption material: never transform
    [`https://psono.example.com/link-share-access.html#!/link-share-access/${ID}/abcdef/https%3A%2F%2Fpsono.example.com%2Fserver`],
    // unknown routes / pages
    [`https://psono.example.com/index.html`],
    [`https://psono.example.com/index.html#!/datastore`],
    [`https://psono.example.com/index.html#!/settings`],
    [`https://psono.example.com/other.html#!/datastore/search/${ID}`],
    [`https://psono.example.com/open-secret.html#!/datastore/search/${ID}`],
    [`https://psono.example.com/index.html#!/secret/website_password/${ID}`],
    // malformed ids and suffixes
    [`https://psono.example.com/index.html#!/datastore/search/not-a-uuid`],
    [`https://psono.example.com/index.html#!/datastore/search/${ID}/`],
    [`https://psono.example.com/index.html#!/datastore/search/${ID}x`],
    [`https://psono.example.com/index.html#!/datastore/search/${ID}?x=1`],
    [`https://psono.example.com/index.html#!/datastore/edit/Bad-Type/${ID}`],
    // query string, encoding tricks, whitespace
    [`https://psono.example.com/index.html?x=1#!/datastore/search/${ID}`],
    [`https://psono.example.com/index.html#!/datastore/search/%30b6c9a3e-1f2d-4c5b-8a7e-9d0c1b2a3f4e`],
    [`https://psono.example.com/index.html#!%2Fdatastore%2Fsearch%2F${ID}`],
    [` https://psono.example.com/index.html#!/datastore/search/${ID}`],
    [`https://psono.example.com/index.html#!/datastore/search/${ID}\n`],
    [`https:\\\\psono.example.com\\index.html#!/datastore/search/${ID}`],
    // not URLs
    [''],
    ['/relative/path'],
    [`#!/datastore/search/${ID}`],
    [`https://psono.example.com/index.html#!/datastore/search/${ID}`.padEnd(3000, 'a')],
  ])('%j', (href) => {
    expect(parse(href)).toBeNull()
  })

  it('accepts http only when the base allows it', () => {
    const dev = normalizePsonoWebBase('http://localhost:10100', { allowHttp: true })
    expect(parsePsonoReference(`http://localhost:10100/index.html#!/datastore/search/${ID}`, dev)?.secretId).toBe(ID)
    expect(parsePsonoReference(`http://localhost:10101/index.html#!/datastore/search/${ID}`, dev)).toBeNull()
  })
})

describe('psonoSecretUrl', () => {
  it('builds the canonical link, which round-trips', () => {
    const url = psonoSecretUrl(base, ID)
    expect(url).toBe(`https://psono.example.com/index.html#!/datastore/search/${ID}`)
    expect(parse(url)?.secretId).toBe(ID)
  })

  it('rejects invalid ids', () => {
    expect(() => psonoSecretUrl(base, '../../x')).toThrow(PsonoConfigError)
  })
})
