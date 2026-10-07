// SPDX-License-Identifier: AGPL-3.0-only
//
// Resolves the Wiki.js user behind a request by asking Wiki.js itself, through
// its public GraphQL API, using the user's own JWT (ADR-0003). The connector
// never verifies or decodes the token on its own.

import { createHash } from 'node:crypto'

export interface WikiUser {
  id: number
}

export interface IdentityOptions {
  wikijsInternalUrl: string
  timeoutMs: number
  cacheTtlMs?: number
  fetch?: typeof fetch
}

export class IdentityUnavailableError extends Error {
  override name = 'IdentityUnavailableError'
}

/** Wiki.js reserves id 2 for the built-in guest account. */
const GUEST_USER_ID = 2
const MAX_CACHE_ENTRIES = 10_000
// `profile` throws AuthRequired for guests/invalid tokens and AuthAccountBanned
// for deactivated users (server/graph/resolvers/user.js), so `id` is enough.
const QUERY = '{ users { profile { id } } }'

/** Extracts the Wiki.js `jwt` cookie from a Cookie header. */
export function extractWikiJwt(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== 'jwt') continue
    const value = part.slice(eq + 1).trim()
    // JWT charset only; anything else is rejected rather than forwarded.
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && value.length <= 8192 ? value : null
  }
  return null
}

export class WikiIdentity {
  private readonly cache = new Map<string, { user: WikiUser | null; expires: number }>()
  private readonly fetchImpl: typeof fetch
  private readonly ttl: number

  constructor(private readonly options: IdentityOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.ttl = options.cacheTtlMs ?? 15_000
  }

  /** Returns the user, `null` if Wiki.js says the token is not a valid signed-in user. */
  async resolve(jwt: string): Promise<WikiUser | null> {
    const key = createHash('sha256').update(jwt).digest('base64url')
    const now = Date.now()
    const cached = this.cache.get(key)
    if (cached && cached.expires > now) return cached.user

    const user = await this.query(jwt)
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      for (const [k, v] of this.cache) if (v.expires <= now) this.cache.delete(k)
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear()
    }
    // Negative answers are cached briefly too, to blunt token-guessing floods.
    this.cache.set(key, { user, expires: now + (user ? this.ttl : 2_000) })
    return user
  }

  private async query(jwt: string): Promise<WikiUser | null> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.options.wikijsInternalUrl}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ query: QUERY }),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch {
      throw new IdentityUnavailableError('Wiki.js not reachable')
    }
    if (response.status >= 500) throw new IdentityUnavailableError(`Wiki.js error ${response.status}`)
    if (response.status !== 200) return null

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new IdentityUnavailableError('Wiki.js returned invalid JSON')
    }
    const profile = (body as { data?: { users?: { profile?: { id?: unknown } | null } } })?.data?.users?.profile
    const errors = (body as { errors?: unknown[] })?.errors
    if (Array.isArray(errors) && errors.length > 0) return null
    if (!profile || typeof profile.id !== 'number' || !Number.isInteger(profile.id)) return null
    if (profile.id < 1 || profile.id === GUEST_USER_ID) return null
    return { id: profile.id }
  }
}
