// SPDX-License-Identifier: AGPL-3.0-only
//
// Psono server pinning (ADR-0009). Psono signs its public `/info/` document
// with an Ed25519 key (`verify_key`, shown as "server signature" in the Psono
// API key dialog). The administrator pins that key; before the connector sends
// anything to the server (the API key id, secret ids) it checks that the
// server can still produce a valid signature with exactly the pinned key. A
// server that was replaced, redirected or impersonated cannot, so the
// connector stops talking to it and the cards say why.
//
// Not a defence against a full relay in the middle (who can forward /info/ to
// the real server); that case is covered by TLS and by the fact that Psono
// responses are authenticated with the API key secret key, which is never sent.

import nacl from 'tweetnacl'
import { readLimited } from './client'

export type ServerCheck = { ok: true } | { ok: false; reason: 'changed' | 'unavailable'; seenKey?: string }

export interface ServerIdentityOptions {
  apiBaseUrl: string
  /** Pinned Ed25519 verify key, 64 hex characters. */
  verifyKey: string
  timeoutMs: number
  /** How long a successful check is trusted. */
  okTtlMs?: number
  /** How long a failed check is remembered before looking again. */
  changedTtlMs?: number
  unavailableTtlMs?: number
  onChange?: (check: ServerCheck) => void
  fetch?: typeof fetch
  now?: () => number
}

const HEX = (n: number) => new RegExp(`^[0-9a-f]{${n}}$`, 'i')
const MAX_INFO_BYTES = 256 * 1024

const hex = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'))

/** Fetches `/info/` and verifies its signature. Returns the signing key that was used. */
export async function fetchServerInfo(
  apiBaseUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ verifyKey: string } | { error: 'changed' | 'unavailable' }> {
  const timeout = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(`${apiBaseUrl}/info/`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    })
  } catch {
    return { error: 'unavailable' }
  }
  let body: string
  try {
    body = await readLimited(response, MAX_INFO_BYTES)
  } catch {
    return { error: 'unavailable' }
  }
  // Server errors are not an identity problem; anything else that is not a
  // validly signed /info/ document is.
  if (response.status >= 500 || response.status === 429) return { error: 'unavailable' }
  if (response.status !== 200) return { error: 'changed' }
  try {
    const doc = JSON.parse(body) as { info?: unknown; signature?: unknown; verify_key?: unknown }
    if (typeof doc.info !== 'string' || typeof doc.signature !== 'string' || typeof doc.verify_key !== 'string') return { error: 'changed' }
    if (!HEX(128).test(doc.signature) || !HEX(64).test(doc.verify_key)) return { error: 'changed' }
    const valid = nacl.sign.detached.verify(Buffer.from(doc.info, 'utf8'), hex(doc.signature), hex(doc.verify_key))
    return valid ? { verifyKey: doc.verify_key.toLowerCase() } : { error: 'changed' }
  } catch {
    return { error: 'changed' }
  }
}

export class ServerIdentity {
  private readonly pinned: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private cached: { result: ServerCheck; until: number } | null = null
  private inflight: Promise<ServerCheck> | null = null
  private lastKind: string | null = null

  constructor(private readonly options: ServerIdentityOptions) {
    if (!HEX(64).test(options.verifyKey)) throw new Error('verifyKey must be 64 hex characters')
    this.pinned = options.verifyKey.toLowerCase()
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  /** Cached verdict; at most one network check at a time. */
  async check(signal?: AbortSignal): Promise<ServerCheck> {
    if (this.cached && this.cached.until > this.now()) return this.cached.result
    this.inflight ??= this.verify(signal).finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async verify(signal?: AbortSignal): Promise<ServerCheck> {
    const info = await fetchServerInfo(this.options.apiBaseUrl, this.options.timeoutMs, this.fetchImpl, signal)
    let result: ServerCheck
    if ('error' in info) result = { ok: false, reason: info.error }
    else if (info.verifyKey === this.pinned) result = { ok: true }
    else result = { ok: false, reason: 'changed', seenKey: info.verifyKey }

    const ttl = result.ok
      ? (this.options.okTtlMs ?? 5 * 60_000)
      : result.reason === 'changed'
        ? (this.options.changedTtlMs ?? 30_000)
        : (this.options.unavailableTtlMs ?? 5_000)
    this.cached = { result, until: this.now() + ttl }

    const kind = result.ok ? 'ok' : result.reason
    if (kind !== this.lastKind) {
      this.lastKind = kind
      this.options.onChange?.(result)
    }
    return result
  }
}
