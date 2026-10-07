// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, loadConfig, parseTrustedProxies } from '../../src/sidecar/config'

describe('PSONO_CONNECTOR_TRUSTED_PROXIES', () => {
  it.each([
    ['10.0.0.10', ['10.0.0.10']],
    ['10.0.0.10, 10.0.0.11', ['10.0.0.10', '10.0.0.11']],
    ['10.0.0.0/24 fd00::/8', ['10.0.0.0/24', 'fd00::/8']],
    ['uniquelocal', ['uniquelocal']],
    ['loopback,linklocal', ['loopback', 'linklocal']],
    ['', []],
  ])('accepts %j', (raw, expected) => {
    expect(parseTrustedProxies(raw)).toEqual(expected)
  })

  it.each(['nginx', '10.0.0.300', '10.0.0.0/33', '::1/129', '10.0.0.1/8/8', 'privatenet'])('rejects %j with a helpful message', (raw) => {
    expect(() => parseTrustedProxies(raw)).toThrow(ConfigError)
    expect(() => parseTrustedProxies(raw)).toThrow(/IP address, a CIDR range or one of loopback, linklocal, uniquelocal/)
  })
})

describe('secret files (*_FILE)', () => {
  const env = (file: string) => ({
    PSONO_CONNECTOR_PUBLIC_URL: 'https://wiki.example.com',
    PSONO_WEB_BASE_URL: 'https://psono.example.com',
    PSONO_API_BASE_URL: 'https://psono.example.com/server',
    WIKIJS_INTERNAL_URL: 'http://wikijs:3000',
    DATABASE_URL: 'postgres://x@y/z',
    PSONO_SERVER_VERIFY_KEY: 'cd'.repeat(32),
    PSONO_CONNECTOR_MASTER_KEY_FILE: file,
  })

  it('reads the key from a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psc-key-'))
    const file = join(dir, 'master.key')
    writeFileSync(file, 'ab'.repeat(32) + '\n')
    expect(loadConfig(env(file)).masterKey.key).toHaveLength(32)
  })

  it('a missing file says the path is inside the container and what to keep', () => {
    expect(() => loadConfig(env('master.key'))).toThrow(/cannot read "master\.key" \(ENOENT\).*INSIDE the container.*\/run\/secrets\/master_key/)
  })

  it.skipIf(process.getuid?.() === 0)('an unreadable file points at the ownership fix (container user uid 1000)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'psc-key-'))
    const file = join(dir, 'master.key')
    writeFileSync(file, 'ab'.repeat(32))
    chmodSync(file, 0o000)
    expect(() => loadConfig(env(file))).toThrow(/\(EACCES\).*uid 1000.*chown 1000:1000/)
  })

  it('never echoes a value that looks like the secret itself', () => {
    const secret = 'ab'.repeat(32)
    try {
      loadConfig(env(secret))
      throw new Error('should have thrown')
    } catch (err) {
      expect((err as Error).message).toContain('(value hidden)')
      expect((err as Error).message).not.toContain(secret)
    }
  })
})

describe('loadConfig', () => {
  const base = {
    PSONO_CONNECTOR_PUBLIC_URL: 'https://wiki.example.com',
    PSONO_WEB_BASE_URL: 'https://psono.example.com',
    PSONO_API_BASE_URL: 'https://psono.example.com/server',
    WIKIJS_INTERNAL_URL: 'http://wikijs:3000',
    DATABASE_URL: 'postgres://x@y/z',
    PSONO_CONNECTOR_MASTER_KEY: 'ab'.repeat(32),
    PSONO_SERVER_VERIFY_KEY: 'cd'.repeat(32),
  }

  it('defaults: 30-day browser enrollment, Secure cookies on https', () => {
    const c = loadConfig(base)
    expect(c.deviceTtlMs).toBe(30 * 86_400_000)
    expect(c.secureCookies).toBe(true)
  })

  it('allows shorter enrollments but never more than 30 days', () => {
    expect(loadConfig({ ...base, PSONO_CONNECTOR_DEVICE_TTL_DAYS: '7' }).deviceTtlMs).toBe(7 * 86_400_000)
    expect(() => loadConfig({ ...base, PSONO_CONNECTOR_DEVICE_TTL_DAYS: '31' })).toThrow(ConfigError)
  })

  it('rate limit: 300 lookups per minute by default, adjustable within sane bounds', () => {
    expect(loadConfig(base).resolvePerMinute).toBe(300)
    expect(loadConfig({ ...base, PSONO_CONNECTOR_RESOLVE_PER_MINUTE: '1000' }).resolvePerMinute).toBe(1000)
    for (const bad of ['5', '20000', 'many']) {
      expect(() => loadConfig({ ...base, PSONO_CONNECTOR_RESOLVE_PER_MINUTE: bad })).toThrow(ConfigError)
    }
  })

  it('refuses http without the explicit development flag', () => {
    expect(() => loadConfig({ ...base, PSONO_CONNECTOR_PUBLIC_URL: 'http://wiki.example.com' })).toThrow(ConfigError)
    const dev = loadConfig({ ...base, PSONO_CONNECTOR_PUBLIC_URL: 'http://wiki.example.com', PSONO_CONNECTOR_ALLOW_HTTP: 'true' })
    expect(dev.secureCookies).toBe(false)
  })

  it('requires a valid server verify key and explains how to get it', () => {
    const { PSONO_SERVER_VERIFY_KEY: _unused, ...withoutPin } = base
    expect(() => loadConfig(withoutPin)).toThrow(/PSONO_SERVER_VERIFY_KEY is required.*print-server-pin/)
    expect(() => loadConfig({ ...base, PSONO_SERVER_VERIFY_KEY: 'short' })).toThrow(ConfigError)
    expect(loadConfig({ ...base, PSONO_SERVER_VERIFY_KEY: 'CD'.repeat(32) }).psonoVerifyKey).toBe('cd'.repeat(32))
  })
})
