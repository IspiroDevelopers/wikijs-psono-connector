// SPDX-License-Identifier: AGPL-3.0-only
//
// Recognises links to the configured Psono web client and extracts the secret
// id. Shared by the Wiki.js renderer, the sidecar (which re-validates every
// URL it receives) and the browser bundle. Pure, dependency-free, no I/O.
//
// Link formats are documented in docs/research-psono.md.

export interface PsonoWebBase {
  /** Lower-cased origin, default port elided, e.g. `https://psono.example.com`. */
  origin: string
  /** Directory of the web client, always starting and ending with `/`. */
  basePath: string
  allowHttp: boolean
}

export type PsonoReferenceRoute = 'datastore-search' | 'datastore-edit' | 'open-secret'

export interface PsonoReference {
  /** Canonical lower-case UUID. */
  secretId: string
  route: PsonoReferenceRoute
}

export interface NormalizeOptions {
  /** Accept `http:` — development only. */
  allowHttp?: boolean
}

export class PsonoConfigError extends Error {
  override name = 'PsonoConfigError'
}

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const ITEM_TYPE = '[a-z][a-z0-9_]{0,63}'

const INDEX_ROUTES: Array<[RegExp, PsonoReferenceRoute]> = [
  [new RegExp(`^#!/datastore/search/(${UUID})$`), 'datastore-search'],
  [new RegExp(`^#!/datastore/edit/${ITEM_TYPE}/(${UUID})$`), 'datastore-edit'],
]
const OPEN_SECRET_ROUTE = new RegExp(`^#!/secret/${ITEM_TYPE}/(${UUID})$`)

/** Hard cap so pathological hrefs are rejected before any regex work. */
const MAX_URL_LENGTH = 2048

function parseUrl(value: string): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return null
  }
  // Reject anything the WHATWG parser would silently repair: whitespace,
  // control characters and backslashes.
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) {
    return null
  }
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isAllowedProtocol(url: URL, allowHttp: boolean): boolean {
  return url.protocol === 'https:' || (allowHttp && url.protocol === 'http:')
}

/**
 * Validates and normalises the admin-configured Psono web client URL, e.g.
 * `https://psono.example.com` or `https://example.com/psono/index.html`.
 * Throws {@link PsonoConfigError} with a message safe to show to an admin.
 */
export function normalizePsonoWebBase(value: string, options: NormalizeOptions = {}): PsonoWebBase {
  const allowHttp = options.allowHttp === true
  const url = parseUrl(typeof value === 'string' ? value.trim() : '')
  if (!url) {
    throw new PsonoConfigError('Psono web URL is not a valid absolute URL.')
  }
  if (!isAllowedProtocol(url, allowHttp)) {
    throw new PsonoConfigError(allowHttp ? 'Psono web URL must use https or http.' : 'Psono web URL must use https.')
  }
  if (url.username || url.password) {
    throw new PsonoConfigError('Psono web URL must not contain credentials.')
  }
  if (url.search || url.hash) {
    throw new PsonoConfigError('Psono web URL must not contain a query string or fragment.')
  }
  if (url.pathname.includes('%')) {
    throw new PsonoConfigError('Psono web URL path must not be percent-encoded.')
  }
  let basePath = url.pathname
  if (basePath.endsWith('/index.html')) {
    basePath = basePath.slice(0, -'index.html'.length)
  }
  if (!basePath.endsWith('/')) {
    basePath += '/'
  }
  return { origin: url.origin, basePath, allowHttp }
}

/**
 * Returns the secret reference for an href pointing at the configured Psono
 * web client, or `null` for anything else (including Psono links that are not
 * secret links, such as link shares, which must never be transformed).
 */
export function parsePsonoReference(href: string, base: PsonoWebBase): PsonoReference | null {
  const url = parseUrl(href)
  if (!url) return null
  if (!isAllowedProtocol(url, base.allowHttp)) return null
  if (url.username || url.password) return null
  // `origin` is lower-cased and drops default ports, so this is an exact
  // scheme + host + port comparison: no suffix, subdomain or look-alike match.
  if (url.origin !== base.origin) return null
  if (url.search) return null

  const hash = url.hash
  if (hash.includes('%')) return null

  const path = url.pathname
  if (path === base.basePath || path === `${base.basePath}index.html`) {
    for (const [pattern, route] of INDEX_ROUTES) {
      const match = pattern.exec(hash)
      if (match?.[1]) return { secretId: match[1].toLowerCase(), route }
    }
    return null
  }
  if (path === `${base.basePath}open-secret.html`) {
    const match = OPEN_SECRET_ROUTE.exec(hash)
    if (match?.[1]) return { secretId: match[1].toLowerCase(), route: 'open-secret' }
  }
  return null
}

/** Canonical link for a secret, used for "Open in Psono" buttons. */
export function psonoSecretUrl(base: PsonoWebBase, secretId: string): string {
  if (!new RegExp(`^${UUID}$`).test(secretId)) {
    throw new PsonoConfigError('Invalid secret id.')
  }
  return `${base.origin}${base.basePath}index.html#!/datastore/search/${secretId.toLowerCase()}`
}
