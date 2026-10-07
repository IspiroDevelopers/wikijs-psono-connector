// SPDX-License-Identifier: AGPL-3.0-only
//
// Wiki.js 2.x rendering module (child of htmlCore, default "pre" step).
// Marks anchors that point at the configured Psono web client so the browser
// bundle can enhance them. It never contacts Psono and never emits secret
// data: the output is the original link plus a class and the secret id.
// See docs/adr/0002-placeholder-is-a-plain-anchor.md.

import { normalizePsonoWebBase, parsePsonoReference, type PsonoWebBase } from '../shared/psono-reference'

export const LINK_CLASS = 'psono-connector-link'
export const SECRET_ID_ATTR = 'data-psono-secret-id'

/** Values of the `props` declared in definition.yml, as stored by Wiki.js. */
export interface RendererConfig {
  psonoWebBaseUrl?: string
  allowHttp?: boolean
}

// Minimal structural view of the cheerio 1.0.0-rc.5 API that Wiki.js passes in.
interface CheerioSelection {
  each(fn: (index: number, element: unknown) => void): unknown
  attr(name: string): string | undefined
  attr(name: string, value: string): CheerioSelection
  addClass(name: string): CheerioSelection
  closest(selector: string): { length: number }
}
type CheerioRoot = (selector: string | unknown) => CheerioSelection

/** Links inside these elements are examples, not references. */
const SKIP_ANCESTORS = 'pre, code, kbd, samp'

function warn(message: string): void {
  const logger = (globalThis as { WIKI?: { logger?: { warn?: (m: string) => void } } }).WIKI?.logger
  if (logger?.warn) logger.warn(`(RENDERING/PSONO-CONNECTOR) ${message}`)
}

export function transform($: CheerioRoot, base: PsonoWebBase): number {
  let count = 0
  $('a[href]').each((_index, element) => {
    const anchor = $(element)
    if (anchor.closest(SKIP_ANCESTORS).length > 0) return
    const href = anchor.attr('href')
    if (!href) return
    const reference = parsePsonoReference(href, base)
    if (!reference) return

    anchor.addClass(LINK_CLASS)
    anchor.attr(SECRET_ID_ATTR, reference.secretId)
    anchor.attr('rel', 'noopener noreferrer')
    count++
  })
  return count
}

export async function init($: CheerioRoot, config: RendererConfig | undefined): Promise<void> {
  const raw = config?.psonoWebBaseUrl?.trim()
  if (!raw) return
  let base: PsonoWebBase
  try {
    base = normalizePsonoWebBase(raw, { allowHttp: config?.allowHttp === true })
  } catch (err) {
    // A bad setting must never break page rendering: leave links untouched.
    warn(`Invalid Psono web URL setting, links left unchanged: ${(err as Error).message}`)
    return
  }
  if (base.allowHttp && base.origin.startsWith('http:')) {
    warn('INSECURE: Psono web URL uses plain HTTP (development only). Use https:// in production.')
  }
  transform($, base)
}
