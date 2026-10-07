// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
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
