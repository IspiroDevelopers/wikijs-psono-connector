// SPDX-License-Identifier: AGPL-3.0-only
//
// Tiny DOM builder. Text is always set through textContent; there is no code
// path that turns data into HTML.

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | boolean | undefined | ((ev: Event) => void)>

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, '').toLowerCase(), value)
    else if (value === true) el.setAttribute(key, '')
    else el.setAttribute(key, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return el
}

/** Returns the URL only if it is http(s); used for clickable links from Psono data. */
export function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function isDarkTheme(): boolean {
  if (document.querySelector('.v-application.theme--dark, .theme--dark.v-application')) return true
  if (document.querySelector('.v-application.theme--light')) return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
