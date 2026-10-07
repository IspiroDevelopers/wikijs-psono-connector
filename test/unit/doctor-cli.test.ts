// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installModule } from '../../src/sidecar/cli'
import { ConfigError, loadConfig } from '../../src/sidecar/config'
import { formatFindings, runDoctor } from '../../src/sidecar/doctor'
import { makeServerIdentity } from '../helpers/psono-fixtures'

const server = makeServerIdentity()
const ENV: Record<string, string | undefined> = {
  PSONO_CONNECTOR_PUBLIC_URL: 'https://wiki.example.com',
  PSONO_WEB_BASE_URL: 'https://psono.example.com',
  PSONO_API_BASE_URL: 'https://psono.example.com/server',
  WIKIJS_INTERNAL_URL: 'http://wikijs:3000',
  DATABASE_URL: 'postgres://user:secret-password@db/x',
  PSONO_CONNECTOR_MASTER_KEY: 'ab'.repeat(32),
  PSONO_SERVER_VERIFY_KEY: server.verifyKey,
  PSONO_CONNECTOR_TRUSTED_PROXIES: 'uniquelocal',
}

/** Routes requests of the doctor to fake Wiki.js, Psono and proxy answers. */
function fakeNetwork(overrides: { wiki?: () => Response; psono?: () => Response; proxy?: () => Response } = {}) {
  return (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.startsWith('http://wikijs:3000/graphql')) return (overrides.wiki ?? (() => Response.json({ data: { __typename: 'Query' } })))()
    if (u.endsWith('/server/info/')) return (overrides.psono ?? (() => Response.json(server.infoResponse())))()
    if (u.endsWith('/psono-connector/healthz')) return (overrides.proxy ?? (() => Response.json({ status: 'ok' })))()
    throw new TypeError(`unexpected ${u}`)
  }) as typeof fetch
}

const run = (env: Record<string, string | undefined> = ENV, net = fakeNetwork(), db: string | null = null) =>
  runDoctor(env, { fetch: net, checkDatabase: async () => db })
const level = (findings: Awaited<ReturnType<typeof run>>, name: string) => findings.find((f) => f.name === name)?.level

describe('doctor', () => {
  it('passes on a healthy deployment', async () => {
    const findings = await run()
    expect(findings.every((f) => f.level === 'ok')).toBe(true)
    expect(formatFindings(findings)).toContain('All checks passed.')
  })

  it('reports a configuration error and stops', async () => {
    const { PSONO_SERVER_VERIFY_KEY: _x, ...env } = ENV
    const findings = await run(env)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ level: 'fail', name: 'Configuration' })
    expect(findings[0]!.detail).toContain('print-server-pin')
  })

  it('flags plain HTTP as a failure', async () => {
    const findings = await run({ ...ENV, PSONO_CONNECTOR_PUBLIC_URL: 'http://wiki.example.com', PSONO_CONNECTOR_ALLOW_HTTP: 'true' })
    expect(level(findings, 'HTTPS')).toBe('fail')
  })

  it('flags a changed Psono server prominently', async () => {
    const impostor = makeServerIdentity()
    const findings = await run(ENV, fakeNetwork({ psono: () => Response.json(impostor.infoResponse()) }))
    const f = findings.find((x) => x.name === 'Psono server')!
    expect(f.level).toBe('fail')
    expect(f.detail).toContain('IDENTITY MISMATCH')
  })

  it('points at the likely mistake when the API URL is not the Psono server', async () => {
    const findings = await run(ENV, fakeNetwork({ psono: () => new Response('<html></html>', { status: 200 }) }))
    expect(findings.find((x) => x.name === 'Psono server')!.detail).toContain('usually …/server')
  })

  it('reports an unreachable database without leaking the connection string', async () => {
    const findings = await run(ENV, fakeNetwork(), 'ECONNREFUSED')
    expect(level(findings, 'Database')).toBe('fail')
    expect(JSON.stringify(findings)).not.toContain('secret-password')
  })

  it('fails when Wiki.js does not answer like Wiki.js', async () => {
    const findings = await run(ENV, fakeNetwork({ wiki: () => new Response('nope', { status: 502 }) }))
    expect(level(findings, 'Wiki.js')).toBe('fail')
  })

  it('fails when the proxy answers but not like the sidecar, only warns when unreachable', async () => {
    expect(level(await run(ENV, fakeNetwork({ proxy: () => new Response('Wiki.js 404', { status: 404 }) })), 'Reverse proxy')).toBe('fail')
    const unreachable = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/psono-connector/healthz')) throw new TypeError('fetch failed')
      return fakeNetwork()(url)
    }) as typeof fetch
    expect(level(await run(ENV, unreachable), 'Reverse proxy')).toBe('warn')
  })

  it('warns when trusted proxies are not configured', async () => {
    const { PSONO_CONNECTOR_TRUSTED_PROXIES: _x, ...env } = ENV
    expect(level(await run(env), 'Trusted proxies')).toBe('warn')
  })
})

describe('install-module', () => {
  const source = () => {
    const dir = mkdtempSync(join(tmpdir(), 'psc-src-'))
    writeFileSync(join(dir, 'renderer.js'), '// renderer')
    writeFileSync(join(dir, 'VERSION'), '1.2.3\n')
    return dir
  }

  it('copies the module and replaces an older copy', () => {
    const target = join(mkdtempSync(join(tmpdir(), 'psc-dst-')), 'modules')
    const dest = installModule(target, source())
    expect(readFileSync(join(dest, 'VERSION'), 'utf8')).toBe('1.2.3\n')
    mkdirSync(join(dest, 'stale'))
    writeFileSync(join(dest, 'stale', 'old.js'), 'x')
    installModule(target, source())
    expect(existsSync(join(dest, 'stale'))).toBe(false)
    expect(dest.endsWith('/modules/html-psono-connector')).toBe(true)
  })

  it('refuses when module files are missing', () => {
    expect(() => installModule(tmpdir(), mkdtempSync(join(tmpdir(), 'psc-empty-')))).toThrow(/Module files not found/)
  })
})

describe('source link (AGPL §13)', () => {
  const base = { ...ENV }
  it('defaults to the project repository and accepts an override', () => {
    expect(loadConfig(base).sourceUrl).toMatch(/^https:\/\/github\.com\/.+\/wikijs-psono-connector$/)
    expect(loadConfig({ ...base, PSONO_CONNECTOR_SOURCE_URL: 'https://git.example.org/me/fork/' }).sourceUrl).toBe('https://git.example.org/me/fork')
  })
  it('rejects non-https and credentialed URLs', () => {
    for (const bad of ['http://x.example/a', 'https://u:p@x.example/a', 'javascript:alert(1)']) {
      expect(() => loadConfig({ ...base, PSONO_CONNECTOR_SOURCE_URL: bad })).toThrow(ConfigError)
    }
  })
})
