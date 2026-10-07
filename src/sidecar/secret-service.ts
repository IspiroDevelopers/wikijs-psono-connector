// SPDX-License-Identifier: AGPL-3.0-only
//
// Orchestrates one request: connector enabled → URL is a supported Psono link
// on the configured host → user has stored credentials → Psono grants the
// key access → allow-listed fields only.

import { createHash } from 'node:crypto'
import { parsePsonoReference, type PsonoWebBase } from '../shared/psono-reference'
import type { CredentialStore, DeviceToken } from './db/credential-store'
import { PsonoError, type PsonoClient } from './psono/client'
import type { ServerCheck, ServerIdentity } from './psono/server-identity'
import { mapSecret, type MappedSecret, type SecretSummary } from './psono/secret-mapper'
import { totpAt, type TotpCode } from './psono/totp'

export type FailureStatus =
  | 'disabled'
  | 'not_configured'
  | 'unsupported_reference'
  | 'forbidden'
  | 'invalid_credentials'
  /** The Psono server no longer proves the pinned identity (ADR-0009). Nothing was sent to it. */
  | 'server_changed'
  | 'unavailable'
  | 'error'

export type Failure = { status: FailureStatus }

/** Who is asking: the Wiki.js user and the device token from their browser cookie. */
export interface Caller {
  userId: number
  device: DeviceToken | null
}
export type OtpPayload = { code: string; validUntil: string; periodSeconds: number }

/** Metadata only: password and OTP code are fetched on explicit request (reveal / otp). */
export type ResolveResult = Failure | { status: 'success'; secret: SecretSummary }
export type RevealResult = Failure | { status: 'success'; password: string } | { status: 'no_password' }
export type OtpResult = Failure | { status: 'success'; otp: OtpPayload } | { status: 'no_otp' }

export interface AuditLogger {
  info(obj: Record<string, unknown>, msg: string): void
  warn(obj: Record<string, unknown>, msg: string): void
  error(obj: Record<string, unknown>, msg: string): void
}

export interface SecretServiceOptions {
  enabled: boolean
  psonoWeb: PsonoWebBase
  store: CredentialStore
  psono: PsonoClient
  /** Verifies the pinned server identity before anything is sent to Psono. */
  serverIdentity: ServerIdentity
  log: AuditLogger
  now?: () => Date
}

/** Secret ids are logged as a short hash: correlatable, not directly usable. */
export function secretRef(secretId: string): string {
  return createHash('sha256').update(`psono-secret:${secretId}`).digest('base64url').slice(0, 12)
}

function otpPayload(code: TotpCode): OtpPayload {
  return { code: code.code, validUntil: code.validUntil.toISOString(), periodSeconds: code.periodSeconds }
}

export class SecretService {
  private readonly now: () => Date

  constructor(private readonly options: SecretServiceOptions) {
    this.now = options.now ?? (() => new Date())
  }

  get enabled(): boolean {
    return this.options.enabled
  }

  /** Cached verdict on the Psono server's identity. */
  checkServer(signal?: AbortSignal): Promise<ServerCheck> {
    return this.options.serverIdentity.check(signal)
  }

  /** Loads the secret through every check. Returns either a Failure or the mapped secret. */
  private async load(caller: Caller, url: unknown, action: string, signal?: AbortSignal): Promise<Failure | { mapped: MappedSecret; ref: string }> {
    const { log } = this.options
    const userId = caller.userId
    if (!this.options.enabled) return { status: 'disabled' }
    const reference = typeof url === 'string' ? parsePsonoReference(url, this.options.psonoWeb) : null
    if (!reference) return { status: 'unsupported_reference' }
    const ref = secretRef(reference.secretId)

    // Pinned server identity (ADR-0009) comes first: before this browser's key is
    // even decrypted, and before onboarding users to enter a key for a server we
    // cannot verify. Nothing leaves the sidecar unless the check passes.
    const server = await this.checkServer(signal)
    if (!server.ok) return { status: server.reason === 'changed' ? 'server_changed' : 'unavailable' }

    // Device-bound (ADR-0008): without this browser's cookie the key cannot be decrypted.
    const stored = caller.device ? await this.options.store.get(userId, caller.device) : null
    if (!stored) return { status: 'not_configured' }
    const credentials = stored.credentials

    try {
      const data = await this.options.psono.readSecret(credentials, reference.secretId, signal)
      return { mapped: mapSecret(data), ref }
    } catch (err) {
      if (err instanceof PsonoError) {
        const status: FailureStatus = err.kind
        const level = status === 'forbidden' ? 'info' : 'warn'
        log[level]({ event: `secret.${action}`, user: userId, ref, outcome: status }, err.message)
        return { status }
      }
      throw err
    }
  }

  async resolve(caller: Caller, url: unknown, signal?: AbortSignal): Promise<ResolveResult> {
    const userId = caller.userId
    const loaded = await this.load(caller, url, 'resolve', signal)
    if ('status' in loaded) return loaded
    this.options.log.info({ event: 'secret.resolve', user: userId, ref: loaded.ref, outcome: 'success' }, 'Secret metadata loaded')
    return { status: 'success', secret: loaded.mapped.summary }
  }

  async reveal(caller: Caller, url: unknown, signal?: AbortSignal): Promise<RevealResult> {
    const userId = caller.userId
    const loaded = await this.load(caller, url, 'reveal', signal)
    if ('status' in loaded) return loaded
    const { password } = loaded.mapped
    if (password === undefined) return { status: 'no_password' }
    this.options.log.info({ event: 'secret.reveal', user: userId, ref: loaded.ref, outcome: 'success' }, 'Password revealed')
    return { status: 'success', password }
  }

  async otp(caller: Caller, url: unknown, signal?: AbortSignal): Promise<OtpResult> {
    const userId = caller.userId
    const loaded = await this.load(caller, url, 'otp', signal)
    if ('status' in loaded) return loaded
    const { totp } = loaded.mapped
    if (!totp) return { status: 'no_otp' }
    this.options.log.info({ event: 'secret.otp', user: userId, ref: loaded.ref, outcome: 'success' }, 'OTP code shown')
    return { status: 'success', otp: otpPayload(totpAt(totp, this.now())) }
  }
}
