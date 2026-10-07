// SPDX-License-Identifier: AGPL-3.0-only
//
// HTTP surface of the sidecar. Every route lives under /psono-connector/ so a
// reverse proxy can forward that prefix unchanged (ADR-0007).
//
// Checks on every /psono-connector/api/* request (Fastify validates the JSON
// body schema before the `preHandler` hooks run, so a malformed body is answered
// 400 even without a session):
//   - JSON schema of the body, strict, no extra properties                → 400
//   - same-origin guard (custom header + Origin / Sec-Fetch-Site)         → 403
//   - Wiki.js identity from the `jwt` cookie, asked via GraphQL           → 401
//   - per-user rate limit (and a per-IP cap on failed authentications)    → 429
// Responses never carry secrets in headers or logs; see ADR-0003 / ADR-0008.

import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PsonoWebBase } from '../shared/psono-reference'
import type { CredentialStore } from './db/credential-store'
import { clearDeviceCookie, deviceCookie, readDeviceToken } from './device-cookie'
import { RateLimiter, type Limit } from './rate-limiter'
import type { Caller, SecretService } from './secret-service'
import { extractWikiJwt, IdentityUnavailableError, type WikiIdentity } from './wikijs/identity'

export const PREFIX = '/psono-connector'
export const CSRF_HEADER = 'x-psono-connector'

export interface ServerOptions {
  publicOrigin: string
  trustedProxies: string[]
  logLevel: string
  loadMode: 'visible' | 'click'
  passwordVisibleSeconds: number
  /** Lifetime of a browser enrollment (device-bound key, ADR-0008). */
  deviceTtlMs: number
  /** Add `Secure` to the device cookie (public URL is https). */
  secureCookies: boolean
  /** Sent to the bundle so it enhances only genuine links to this Psono (anti-phishing). */
  psonoWeb: PsonoWebBase
  identity: WikiIdentity
  store: CredentialStore
  secrets: SecretService
  /** Public link to this program's source (AGPL-3.0 §13). */
  sourceUrl: string
  /** Directory containing client.js and settings.html; omitted in API-only tests. */
  assetsDir?: string
  rateLimiter?: RateLimiter
  /** Log destination; defaults to stdout. Injected in tests to inspect logs. */
  logStream?: { write(line: string): void }
}

declare module 'fastify' {
  interface FastifyRequest {
    wikiUserId?: number
  }
}

const LIMITS = {
  status: { max: 120, windowMs: 60_000 },
  resolve: { max: 120, windowMs: 60_000 },
  otp: { max: 90, windowMs: 60_000 },
  reveal: { max: 30, windowMs: 60_000 },
  credentials: { max: 10, windowMs: 60_000 },
} satisfies Record<string, Limit>

/**
 * Failed authentications per client IP. Each unknown token costs one GraphQL
 * call to Wiki.js, so this caps the amplification an anonymous client can
 * cause. Behind a proxy, set PSONO_CONNECTOR_TRUSTED_PROXIES so the real client
 * IP is used; otherwise all failures share the proxy's bucket (legitimate users
 * almost never fail authentication, so the impact is limited to guests).
 */
const AUTH_FAILURES: Limit = { max: 60, windowMs: 60_000 }

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

const urlBody = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
} as const

const credentialsBody = {
  type: 'object',
  required: ['apiKeyId', 'apiKeySecretKey'],
  additionalProperties: false,
  properties: {
    apiKeyId: { type: 'string', pattern: UUID_PATTERN },
    apiKeySecretKey: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
  },
} as const

const SETTINGS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const limiter = options.rateLimiter ?? new RateLimiter()
  const app = Fastify({
    bodyLimit: 16 * 1024,
    // Fastify strips unknown properties by default; reject them instead.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    trustProxy: options.trustedProxies.length > 0 ? options.trustedProxies : false,
    // No per-request access log: only explicit, sanitised audit events.
    logController: new LogController({ disableRequestLogging: true }),
    logger: {
      level: options.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      // Never log headers (cookies, JWT) or bodies (API keys, secrets).
      serializers: {
        req: (req) => ({ method: req.method, path: req.url.split('?')[0], ip: req.ip }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: { paths: ['req.headers', 'headers', 'body', 'password', 'apiKeySecretKey'], remove: true },
    },
  })

  // ------------------------------------------------------------------ proxy diagnostics
  // A request that carries X-Forwarded-For but whose IP was not taken from it
  // came through a proxy we do not trust. Say exactly what to configure, once
  // per proxy address.
  const warnedProxies = new Set<string>()
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-forwarded-for'] === undefined) return
    const peer = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
    if (req.ip.replace(/^::ffff:/, '') !== peer || warnedProxies.has(peer) || warnedProxies.size > 50) return
    warnedProxies.add(peer)
    req.log.warn(
      { event: 'proxy.untrusted', proxy: peer },
      `Requests arrive through a reverse proxy at ${peer} that is not trusted, so client IPs are not visible. ` +
        `Set PSONO_CONNECTOR_TRUSTED_PROXIES=${peer} (or "uniquelocal" to trust any private-network proxy).`,
    )
  })

  // ------------------------------------------------------------------ headers
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('cache-control', 'no-store, private')
    reply.header('pragma', 'no-cache')
    reply.header('expires', '0')
    reply.header('vary', 'Cookie')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('cross-origin-resource-policy', 'same-origin')
    reply.header('x-frame-options', 'DENY')
    // JSON and JS responses never need to load anything; the settings page sets its own CSP.
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
    }
    return payload
  })

  app.setErrorHandler((err: { validation?: unknown; statusCode?: number; message?: string }, req, reply) => {
    if (err.validation) return reply.code(400).send({ status: 'bad_request' })
    if (err.statusCode === 413 || err.statusCode === 415) return reply.code(err.statusCode).send({ status: 'bad_request' })
    req.log.error({ event: 'http.error', err: { message: err.message } }, 'Unhandled error')
    return reply.code(500).send({ status: 'error' })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ status: 'not_found' }))

  // ------------------------------------------------------------------ guards
  function sameOrigin(req: FastifyRequest): boolean {
    if (req.headers[CSRF_HEADER] !== '1') return false
    const site = req.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin') return false
    const origin = req.headers.origin
    if (origin !== undefined && origin !== options.publicOrigin) return false
    // State-changing or secret-returning calls need at least one positive signal.
    if (req.method !== 'GET' && origin === undefined && site === undefined) return false
    return true
  }

  async function authenticate(req: FastifyRequest, reply: FastifyReply) {
    if (!sameOrigin(req)) {
      req.log.warn({ event: 'http.forbidden_origin' }, 'Rejected cross-origin or unmarked API call')
      return reply.code(403).send({ status: 'forbidden_origin' })
    }
    const jwt = extractWikiJwt(req.headers.cookie)
    if (!jwt) return reply.code(401).send({ status: 'unauthenticated' })
    const failKey = `authfail:${req.ip}`
    if (limiter.exhausted(failKey, AUTH_FAILURES)) return reply.code(429).send({ status: 'rate_limited' })
    try {
      const user = await options.identity.resolve(jwt)
      if (!user) {
        limiter.take(failKey, AUTH_FAILURES)
        return reply.code(401).send({ status: 'unauthenticated' })
      }
      req.wikiUserId = user.id
    } catch (err) {
      if (err instanceof IdentityUnavailableError) {
        req.log.warn({ event: 'wikijs.unavailable' }, err.message)
        return reply.code(503).send({ status: 'unavailable' })
      }
      throw err
    }
  }

  function limited(bucket: keyof typeof LIMITS) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (!limiter.take(`${bucket}:${req.wikiUserId}`, LIMITS[bucket])) {
        return reply.code(429).send({ status: 'rate_limited' })
      }
    }
  }

  const userId = (req: FastifyRequest): number => {
    if (req.wikiUserId === undefined) throw new Error('authenticate hook did not run')
    return req.wikiUserId
  }

  /**
   * Aborts the Psono call if the browser goes away. Uses the *response* close
   * event: the request's own `close` also fires once the body has been read.
   */
  function clientAbortSignal(reply: FastifyReply): AbortSignal {
    const controller = new AbortController()
    reply.raw.once('close', () => {
      if (!reply.raw.writableFinished) controller.abort()
    })
    return controller.signal
  }

  function statusCode(status: string): number {
    if (status === 'unavailable' || status === 'server_changed') return 502
    if (status === 'error') return 500
    return 200
  }

  // ------------------------------------------------------------------ public
  app.get(`${PREFIX}/healthz`, async () => ({ status: 'ok' }))
  // Corresponding Source for network users (AGPL-3.0 §13); linked from the settings page.
  app.get(`${PREFIX}/source`, async (_req, reply) => reply.redirect(options.sourceUrl, 302))

  if (options.assetsDir) {
    const assets = options.assetsDir
    app.get(`${PREFIX}/client.js`, async (_req, reply) => {
      const js = await readFile(join(assets, 'client.js'))
      return reply.type('text/javascript; charset=utf-8').send(js)
    })
    app.get(`${PREFIX}/settings`, async (_req, reply) => {
      const html = await readFile(join(assets, 'settings.html'))
      reply.header('content-security-policy', SETTINGS_CSP)
      return reply.type('text/html; charset=utf-8').send(html)
    })
  }

  // ------------------------------------------------------------------ API
  const caller = (req: FastifyRequest): Caller => ({ userId: userId(req), device: readDeviceToken(req.headers.cookie) })

  await app.register(async (api) => {
    api.addHook('preHandler', authenticate)

    api.get('/me/status', { preHandler: limited('status') }, async (req, reply) => {
      const { userId: id, device } = caller(req)
      const stored = device ? await options.store.get(id, device) : null
      // A cookie that no longer maps to a usable key (expired, removed, other user) is cleared.
      if (device && !stored) reply.header('set-cookie', clearDeviceCookie(options.secureCookies))
      const server = await options.secrets.checkServer()
      return {
        status: 'success',
        pluginEnabled: options.secrets.enabled,
        credentialsConfigured: stored !== null,
        credentialsExpiresAt: stored?.expiresAt.toISOString() ?? null,
        // 'changed': the Psono server no longer proves the pinned identity; the UI warns and keys are not accepted.
        psonoServer: server.ok ? 'ok' : server.reason === 'changed' ? 'changed' : 'unknown',
        loadMode: options.loadMode,
        passwordVisibleSeconds: options.passwordVisibleSeconds,
        psonoWeb: options.psonoWeb,
      }
    })

    api.put<{ Body: { apiKeyId: string; apiKeySecretKey: string } }>(
      '/me/credentials',
      { schema: { body: credentialsBody }, preHandler: limited('credentials') },
      async (req, reply) => {
        const { userId: id, device } = caller(req)
        // Never accept a key while the server cannot prove its identity: it would be sent to it on first use.
        if (options.secrets.enabled) {
          const check = await options.secrets.checkServer(clientAbortSignal(reply))
          if (!check.ok && check.reason === 'changed') return reply.code(409).send({ status: 'server_changed' })
        }
        // Replacing on the same browser: drop this browser's previous row first.
        if (device) await options.store.deleteDevice(id, device.deviceId)
        const enrollment = await options.store.enroll(
          id,
          { apiKeyId: req.body.apiKeyId.toLowerCase(), apiKeySecretKey: req.body.apiKeySecretKey.toLowerCase() },
          options.deviceTtlMs,
        )
        reply.header('set-cookie', deviceCookie(enrollment, enrollment.expiresAt, options.secureCookies))
        req.log.info({ event: 'credentials.saved', user: id }, 'Psono API key saved for this browser')
        return { status: 'saved', expiresAt: enrollment.expiresAt.toISOString() }
      },
    )

    api.delete<{ Querystring: { scope?: 'browser' | 'all' } }>(
      '/me/credentials',
      {
        schema: {
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: { scope: { type: 'string', enum: ['browser', 'all'] } },
          },
        },
        preHandler: limited('credentials'),
      },
      async (req, reply) => {
        const { userId: id, device } = caller(req)
        const scope = req.query.scope ?? 'browser'
        // Works without contacting Psono, so a revoked or broken key can always be removed.
        const removed =
          scope === 'all' ? await options.store.deleteAllForUser(id) : device ? Number(await options.store.deleteDevice(id, device.deviceId)) : 0
        reply.header('set-cookie', clearDeviceCookie(options.secureCookies))
        req.log.info({ event: 'credentials.deleted', user: id, scope, removed }, 'Psono API key removed')
        return { status: 'deleted', scope }
      },
    )

    api.post<{ Body: { url: string } }>(
      '/me/credentials/test',
      { schema: { body: urlBody }, preHandler: limited('credentials') },
      async (req, reply) => {
        const result = await options.secrets.resolve(caller(req), req.body.url, clientAbortSignal(reply))
        // Never return secret fields from the test endpoint.
        return reply.code(statusCode(result.status)).send({ status: result.status })
      },
    )

    api.post<{ Body: { url: string } }>(
      '/secrets/resolve',
      { schema: { body: urlBody }, preHandler: limited('resolve') },
      async (req, reply) => {
        const result = await options.secrets.resolve(caller(req), req.body.url, clientAbortSignal(reply))
        return reply.code(statusCode(result.status)).send(result)
      },
    )

    api.post<{ Body: { url: string } }>(
      '/secrets/reveal',
      { schema: { body: urlBody }, preHandler: limited('reveal') },
      async (req, reply) => {
        const result = await options.secrets.reveal(caller(req), req.body.url, clientAbortSignal(reply))
        return reply.code(statusCode(result.status)).send(result)
      },
    )

    api.post<{ Body: { url: string } }>(
      '/secrets/otp',
      { schema: { body: urlBody }, preHandler: limited('otp') },
      async (req, reply) => {
        const result = await options.secrets.otp(caller(req), req.body.url, clientAbortSignal(reply))
        return reply.code(statusCode(result.status)).send(result)
      },
    )
  }, { prefix: `${PREFIX}/api` })

  return app
}
