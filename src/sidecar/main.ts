// SPDX-License-Identifier: AGPL-3.0-only
//
// Sidecar entry point.

import type { FastifyInstance } from 'fastify'
import { join } from 'node:path'
import { ConfigError, loadConfig } from './config'
import { CredentialCipher } from './crypto/credential-cipher'
import { PgCredentialStore } from './db/credential-store'
import { PsonoClient } from './psono/client'
import { ServerIdentity } from './psono/server-identity'
import { HELP, printServerPin, runDoctorCommand, runInstallModule } from './cli'
import { SecretService, type AuditLogger } from './secret-service'
import { buildServer } from './server'
import { WikiIdentity } from './wikijs/identity'

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === '--help' || command === 'help' || command === '-h') return void console.log(HELP)
  if (command === 'print-server-pin') return printServerPin()
  if (command === 'install-module') return runInstallModule(process.argv[3])
  if (command === 'doctor') return runDoctorCommand()
  if (command !== undefined) {
    console.error(`Unknown command: ${command}\n\n${HELP}`)
    process.exit(2)
  }
  let config
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`)
      process.exit(2)
    }
    throw err
  }

  const cipher = new CredentialCipher(config.masterKey, config.previousMasterKeys)
  const store = await PgCredentialStore.connect(config.databaseUrl, cipher, {
    onRetry: (attempt, reason) => console.error(`Database not ready (${reason}), retrying… [${attempt}]`),
  })
  const identity = new WikiIdentity({ wikijsInternalUrl: config.wikijsInternalUrl, timeoutMs: config.requestTimeoutMs })
  const psono = new PsonoClient({ apiBaseUrl: config.psonoApiBaseUrl, timeoutMs: config.requestTimeoutMs })

  // The service logs through Fastify's logger, which only exists once the
  // server is built; the adapter forwards to it.
  let app: FastifyInstance | undefined
  const log: AuditLogger = {
    info: (obj, msg) => app?.log.info(obj, msg),
    warn: (obj, msg) => app?.log.warn(obj, msg),
    error: (obj, msg) => app?.log.error(obj, msg),
  }
  const serverIdentity = new ServerIdentity({
    apiBaseUrl: config.psonoApiBaseUrl,
    verifyKey: config.psonoVerifyKey,
    timeoutMs: config.requestTimeoutMs,
    onChange: (check) => {
      if (check.ok) log.info({ event: 'psono.server_verified' }, 'Psono server identity verified')
      else if (check.reason === 'changed') {
        log.error(
          { event: 'psono.server_changed', seenKey: check.seenKey?.slice(0, 16) ?? null },
          'PSONO SERVER IDENTITY CHANGED: it no longer proves the pinned PSONO_SERVER_VERIFY_KEY. ' +
            'The connector stopped contacting it and no API key was sent. If you replaced or restored the server on purpose, ' +
            'check the new key with "node main.cjs print-server-pin" and update the setting.',
        )
      } else log.warn({ event: 'psono.server_unreachable' }, 'Psono server unreachable while verifying its identity')
    },
  })
  const secrets = new SecretService({ enabled: config.enabled, psonoWeb: config.psonoWeb, store, psono, serverIdentity, log })
  app = await buildServer({
    publicOrigin: config.publicOrigin,
    trustedProxies: config.trustedProxies,
    logLevel: config.logLevel,
    loadMode: config.loadMode,
    passwordVisibleSeconds: config.passwordVisibleSeconds,
    deviceTtlMs: config.deviceTtlMs,
    resolvePerMinute: config.resolvePerMinute,
    secureCookies: config.secureCookies,
    psonoWeb: config.psonoWeb,
    identity,
    store,
    secrets,
    sourceUrl: config.sourceUrl,
    assetsDir: join(__dirname, 'client'),
  })
  const server = app

  // Expired browser enrollments are useless (and undecryptable without their
  // cookie anyway); remove them at start and hourly.
  const purge = () =>
    store
      .purgeExpired()
      .then((n) => n > 0 && server.log.info({ event: 'credentials.purged', removed: n }, 'Expired browser keys removed'))
      .catch((err: Error) => server.log.warn({ event: 'credentials.purge_failed' }, err.message))
  void purge()
  setInterval(() => void purge(), 60 * 60 * 1000).unref()

  const shutdown = async (signal: string) => {
    server.log.info({ event: 'shutdown', signal }, 'Shutting down')
    await server.close()
    await store.close()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  await server.listen({ host: config.listenHost, port: config.listenPort })
  server.log.info(
    {
      event: 'started',
      enabled: config.enabled,
      publicOrigin: config.publicOrigin,
      psonoWeb: `${config.psonoWeb.origin}${config.psonoWeb.basePath}`,
      psonoApi: config.psonoApiBaseUrl,
      allowHttp: config.allowHttp,
      trustedProxies: config.trustedProxies.length > 0 ? config.trustedProxies : 'none',
      deviceTtlDays: config.deviceTtlMs / 86_400_000,
    },
    'Wiki.js Psono Connector sidecar started',
  )
  if (!config.secureCookies) {
    server.log.warn(
      { event: 'insecure_http' },
      '*** NOT USING HTTPS *** PSONO_CONNECTOR_PUBLIC_URL is http://: API keys, passwords, one-time codes and the Wiki.js session travel in clear text. Development only.',
    )
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
