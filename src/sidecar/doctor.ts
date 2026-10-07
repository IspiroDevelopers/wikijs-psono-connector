// SPDX-License-Identifier: AGPL-3.0-only
//
// `node main.cjs doctor` — checks a deployment end to end and says what to fix.
// Runs with the same environment as the sidecar. Never prints secrets: only
// names, hosts and short, non-sensitive details.

import pg from 'pg'
import { ConfigError, loadConfig, type Config } from './config'
import { fetchServerInfo } from './psono/server-identity'

export type Level = 'ok' | 'warn' | 'fail'
export interface Finding {
  level: Level
  name: string
  detail: string
}

export interface DoctorDeps {
  fetch?: typeof fetch
  /** Returns null on success or a short error code/message. */
  checkDatabase?: (databaseUrl: string) => Promise<string | null>
}

async function defaultCheckDatabase(databaseUrl: string): Promise<string | null> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return null
  } catch (err) {
    // Error codes (ECONNREFUSED, 28P01, 3D000…) never contain the password.
    return (err as { code?: string }).code ?? 'connection failed'
  } finally {
    await client.end().catch(() => {})
  }
}

export async function runDoctor(env: Record<string, string | undefined>, deps: DoctorDeps = {}): Promise<Finding[]> {
  const out: Finding[] = []
  const add = (level: Level, name: string, detail: string) => out.push({ level, name, detail })
  const fetchImpl = deps.fetch ?? fetch

  let config: Config
  try {
    config = loadConfig(env)
  } catch (err) {
    add('fail', 'Configuration', err instanceof ConfigError ? err.message : 'invalid configuration')
    return out
  }
  add('ok', 'Configuration', 'all required settings are present and valid')

  // ---- transport security
  const insecure = [config.publicOrigin, config.psonoWeb.origin, config.psonoApiBaseUrl].filter((u) => u.startsWith('http:'))
  if (insecure.length > 0) {
    add('fail', 'HTTPS', 'not everything uses https:// — API keys, passwords and one-time codes would travel in clear text (development only)')
  } else {
    add('ok', 'HTTPS', 'wiki, Psono web client and Psono API all use https://')
  }

  // ---- database
  const dbError = await (deps.checkDatabase ?? defaultCheckDatabase)(config.databaseUrl)
  if (dbError === null) add('ok', 'Database', 'connection works')
  else add('fail', 'Database', `cannot connect (${dbError}); check DATABASE_URL and that the database container is up`)

  // ---- Wiki.js (internal URL)
  try {
    const res = await fetchImpl(`${config.wikijsInternalUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
      redirect: 'manual',
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
    const body = (await res.json().catch(() => null)) as { data?: { __typename?: string } } | null
    if (res.status === 200 && body?.data?.__typename) add('ok', 'Wiki.js', `GraphQL reachable at ${config.wikijsInternalUrl}`)
    else add('fail', 'Wiki.js', `${config.wikijsInternalUrl}/graphql did not answer like Wiki.js (HTTP ${res.status}); check WIKIJS_INTERNAL_URL and the Docker network`)
  } catch {
    add('fail', 'Wiki.js', `cannot reach ${config.wikijsInternalUrl}; check WIKIJS_INTERNAL_URL and that the sidecar is on Wiki.js's Docker network`)
  }

  // ---- Psono server identity
  const info = await fetchServerInfo(config.psonoApiBaseUrl, config.requestTimeoutMs, fetchImpl)
  if ('error' in info) {
    if (info.error === 'unavailable') add('fail', 'Psono server', `${config.psonoApiBaseUrl} is not reachable`)
    else add('fail', 'Psono server', 'it did not return a validly signed /info/ document — is PSONO_API_BASE_URL the Psono *server* URL (usually …/server)?')
  } else if (info.verifyKey === config.psonoVerifyKey) {
    add('ok', 'Psono server', 'identity verified against PSONO_SERVER_VERIFY_KEY')
  } else {
    add('fail', 'Psono server', `IDENTITY MISMATCH: the server signs with ${info.verifyKey.slice(0, 16)}… but ${config.psonoVerifyKey.slice(0, 16)}… is pinned. Do not use the connector until you know why (see docs/configuration.md)`)
  }

  // ---- reverse proxy
  try {
    const res = await fetchImpl(`${config.publicOrigin}/psono-connector/healthz`, { redirect: 'manual', signal: AbortSignal.timeout(config.requestTimeoutMs) })
    const body = (await res.json().catch(() => null)) as { status?: string } | null
    if (res.status === 200 && body?.status === 'ok') add('ok', 'Reverse proxy', `${config.publicOrigin}/psono-connector/ reaches the sidecar`)
    else add('fail', 'Reverse proxy', `${config.publicOrigin}/psono-connector/healthz answered HTTP ${res.status} but not like the sidecar — the proxy rule is missing or wrong (docs/deployment/reverse-proxy.md)`)
  } catch {
    add('warn', 'Reverse proxy', `${config.publicOrigin} is not reachable from here. This can be normal (no route from the container to its own public address); verify from a browser: ${config.publicOrigin}/psono-connector/healthz`)
  }
  if (config.trustedProxies.length === 0) {
    add('warn', 'Trusted proxies', 'PSONO_CONNECTOR_TRUSTED_PROXIES is empty: logs and per-IP limits see the proxy, not the clients (docs/configuration.md)')
  } else {
    add('ok', 'Trusted proxies', config.trustedProxies.join(', '))
  }

  add(
    config.enabled ? 'ok' : 'warn',
    'Connector switch',
    config.enabled ? 'enabled' : 'PSONO_CONNECTOR_ENABLED=false: links stay plain links',
  )
  return out
}

export function formatFindings(findings: Finding[]): string {
  const icon = { ok: '✔', warn: '⚠', fail: '✘' } as const
  const lines = findings.map((f) => `${icon[f.level]} ${f.name}: ${f.detail}`)
  const fails = findings.filter((f) => f.level === 'fail').length
  const warns = findings.filter((f) => f.level === 'warn').length
  lines.push('', fails > 0 ? `${fails} problem(s) to fix.` : warns > 0 ? `No problems; ${warns} warning(s).` : 'All checks passed.')
  return lines.join('\n')
}
