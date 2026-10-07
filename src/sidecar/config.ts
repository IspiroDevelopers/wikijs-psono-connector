// SPDX-License-Identifier: AGPL-3.0-only
//
// Sidecar configuration, read once from environment variables. Every variable
// that holds a secret also accepts a `<NAME>_FILE` variant (Docker secrets).
// Errors name the variable but never echo its value.

import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { normalizePsonoWebBase, type PsonoWebBase } from '../shared/psono-reference'
import { DEFAULT_SOURCE_URL } from './source-url'

export type LoadMode = 'visible' | 'click'

export interface MasterKey {
  version: number
  key: Buffer
}

export interface Config {
  enabled: boolean
  listenHost: string
  listenPort: number
  /** Origin of the wiki as seen by browsers, e.g. `https://wiki.example.com`. */
  publicOrigin: string
  trustedProxies: string[]
  wikijsInternalUrl: string
  psonoWeb: PsonoWebBase
  /** Psono server API base without trailing slash, e.g. `https://psono.example.com/server`. */
  psonoApiBaseUrl: string
  /** Where users can get the source of this (possibly modified) program — AGPL-3.0 §13. */
  sourceUrl: string
  /** Pinned Ed25519 verify key of the Psono server (ADR-0009), lower-case hex. */
  psonoVerifyKey: string
  allowHttp: boolean
  databaseUrl: string
  masterKey: MasterKey
  previousMasterKeys: MasterKey[]
  requestTimeoutMs: number
  loadMode: LoadMode
  passwordVisibleSeconds: number
  /** How long a browser stays enrolled before the user must enter the key again. */
  deviceTtlMs: number
  /** Device cookies get `Secure` when the public URL is https. */
  secureCookies: boolean
  logLevel: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

type Env = Record<string, string | undefined>

function read(env: Env, name: string): string | undefined {
  const fileVar = env[`${name}_FILE`]
  if (fileVar) {
    try {
      return readFileSync(fileVar, 'utf8').trim()
    } catch {
      throw new ConfigError(`${name}_FILE: cannot read file`)
    }
  }
  const value = env[name]
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function required(env: Env, name: string): string {
  const value = read(env, name)
  if (value === undefined) throw new ConfigError(`${name} is required`)
  return value
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = read(env, name)
  if (value === undefined) return fallback
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  throw new ConfigError(`${name} must be true or false`)
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const value = read(env, name)
  if (value === undefined) return fallback
  if (!/^\d+$/.test(value)) throw new ConfigError(`${name} must be an integer`)
  const n = Number(value)
  if (n < min || n > max) throw new ConfigError(`${name} must be between ${min} and ${max}`)
  return n
}

/** Parses a base URL that must have no credentials, query or fragment. */
function baseUrl(env: Env, name: string, allowHttp: boolean, keepPath: boolean): string {
  const raw = required(env, name)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError(`${name} is not a valid URL`)
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new ConfigError(`${name} must use https${allowHttp ? ' or http' : ''}`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError(`${name} must not contain credentials, a query string or a fragment`)
  }
  if (!keepPath) {
    if (url.pathname !== '/') throw new ConfigError(`${name} must be an origin without a path`)
    return url.origin
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Accepts 32 bytes as 64 hex chars or base64/base64url. */
export function parseMasterKey(value: string, name: string): Buffer {
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, 'hex')
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(value)) key = Buffer.from(value, 'base64')
  else throw new ConfigError(`${name} must be 32 random bytes, hex (64 chars) or base64 encoded`)
  if (key.length !== 32) throw new ConfigError(`${name} must decode to exactly 32 bytes`)
  return key
}

/** Shorthands understood by Fastify's trustProxy (proxy-addr). */
export const PROXY_PRESETS: Record<string, string> = {
  loopback: '127.0.0.1/8, ::1/128',
  linklocal: '169.254.0.0/16, fe80::/10',
  uniquelocal: '10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7',
}

/**
 * PSONO_CONNECTOR_TRUSTED_PROXIES: comma/space separated IPs, CIDRs and the
 * presets above. Validated here so a typo fails at startup instead of
 * silently trusting nothing.
 */
export function parseTrustedProxies(raw: string | undefined): string[] {
  if (!raw) return []
  const entries = raw.split(/[\s,]+/).map((e) => e.trim()).filter(Boolean)
  for (const entry of entries) {
    if (entry in PROXY_PRESETS) continue
    const [address, bits, extra] = entry.split('/')
    const family = isIP(address ?? '')
    const validBits =
      bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= (family === 6 ? 128 : 32))
    if (!family || !validBits || extra !== undefined) {
      throw new ConfigError(
        `PSONO_CONNECTOR_TRUSTED_PROXIES: "${entry}" is not an IP address, a CIDR range or one of ${Object.keys(PROXY_PRESETS).join(', ')}`,
      )
    }
  }
  return entries
}

function previousKeys(env: Env): MasterKey[] {
  const raw = read(env, 'PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS')
  if (raw === undefined) return []
  return raw.split(',').map((entry) => {
    const match = /^\s*(\d+):(\S+)\s*$/.exec(entry)
    if (!match?.[1] || !match[2]) {
      throw new ConfigError('PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS must be a comma-separated list of <version>:<key>')
    }
    return { version: Number(match[1]), key: parseMasterKey(match[2], 'PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS') }
  })
}

export function loadConfig(env: Env = process.env): Config {
  const allowHttp = bool(env, 'PSONO_CONNECTOR_ALLOW_HTTP', false)

  let psonoWeb: PsonoWebBase
  try {
    psonoWeb = normalizePsonoWebBase(required(env, 'PSONO_WEB_BASE_URL'), { allowHttp })
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(`PSONO_WEB_BASE_URL: ${(err as Error).message}`)
  }

  const masterKey: MasterKey = {
    version: int(env, 'PSONO_CONNECTOR_MASTER_KEY_VERSION', 1, 1, 65535),
    key: parseMasterKey(required(env, 'PSONO_CONNECTOR_MASTER_KEY'), 'PSONO_CONNECTOR_MASTER_KEY'),
  }
  const previous = previousKeys(env)
  if (previous.some((k) => k.version === masterKey.version)) {
    throw new ConfigError('PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS must not reuse the current key version')
  }

  const verifyKey = read(env, 'PSONO_SERVER_VERIFY_KEY')
  if (verifyKey === undefined || !/^[0-9a-fA-F]{64}$/.test(verifyKey)) {
    throw new ConfigError(
      'PSONO_SERVER_VERIFY_KEY is required: the Psono server\'s verify key (64 hex characters, shown as "server signature" in ' +
        'the Psono API key dialog). Print it with: node main.cjs print-server-pin',
    )
  }

  const loadMode = read(env, 'PSONO_CONNECTOR_LOAD_MODE') ?? 'visible'
  if (loadMode !== 'visible' && loadMode !== 'click') {
    throw new ConfigError('PSONO_CONNECTOR_LOAD_MODE must be "visible" or "click"')
  }

  const publicOrigin = baseUrl(env, 'PSONO_CONNECTOR_PUBLIC_URL', allowHttp, false)
  return {
    enabled: bool(env, 'PSONO_CONNECTOR_ENABLED', true),
    secureCookies: publicOrigin.startsWith('https:'),
    listenHost: read(env, 'PSONO_CONNECTOR_LISTEN_HOST') ?? '0.0.0.0',
    listenPort: int(env, 'PSONO_CONNECTOR_LISTEN_PORT', 3100, 1, 65535),
    publicOrigin,
    trustedProxies: parseTrustedProxies(read(env, 'PSONO_CONNECTOR_TRUSTED_PROXIES')),
    wikijsInternalUrl: baseUrl(env, 'WIKIJS_INTERNAL_URL', true, true),
    psonoWeb,
    psonoApiBaseUrl: baseUrl(env, 'PSONO_API_BASE_URL', allowHttp, true),
    psonoVerifyKey: verifyKey.toLowerCase(),
    sourceUrl: read(env, 'PSONO_CONNECTOR_SOURCE_URL') === undefined ? DEFAULT_SOURCE_URL : baseUrl(env, 'PSONO_CONNECTOR_SOURCE_URL', false, true),
    allowHttp,
    databaseUrl: required(env, 'DATABASE_URL'),
    masterKey,
    previousMasterKeys: previous,
    requestTimeoutMs: int(env, 'PSONO_CONNECTOR_REQUEST_TIMEOUT_MS', 8000, 500, 60000),
    loadMode,
    passwordVisibleSeconds: int(env, 'PSONO_CONNECTOR_PASSWORD_VISIBLE_SECONDS', 30, 5, 600),
    deviceTtlMs: int(env, 'PSONO_CONNECTOR_DEVICE_TTL_DAYS', 30, 1, 30) * 24 * 60 * 60 * 1000,
    logLevel: read(env, 'PSONO_CONNECTOR_LOG_LEVEL') ?? 'info',
  }
}
