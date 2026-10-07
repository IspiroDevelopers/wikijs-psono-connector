// SPDX-License-Identifier: AGPL-3.0-only
//
// Runs the browser bundle in jsdom against a stubbed sidecar and checks which
// anchors it turns into cards.
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePsonoWebBase } from '../../src/shared/psono-reference'

const ID = '7d1f3c2a-9b8e-4f6d-a5c4-3b2a1f0e9d8c'
const GOOD = `https://psono.example.com/index.html#!/datastore/search/${ID}`

interface Page {
  window: Window & typeof globalThis
  calls: Array<{ path: string; body: unknown }>
  /** Closed shadow roots created by the bundle, captured for inspection. */
  roots: ShadowRoot[]
}

const SECRET_WITH_OTP = { type: 'website_password', title: 'T', username: 'u', hasPassword: true, hasOtp: true }
const OTP_CODE = '482913'

const restore: Array<() => void> = []
afterEach(() => {
  while (restore.length) restore.pop()?.()
  vi.resetModules()
})

async function loadPage(html: string, pluginEnabled = true, secret: object = { type: 'website_password', title: 'T', hasPassword: false, hasOtp: false }): Promise<Page> {
  const dom = new (JSDOM as unknown as new (html: string, opts: object) => { window: Window & typeof globalThis })(
    `<!doctype html><html lang="it"><body>${html}</body></html>`,
    { url: 'https://wiki.example.com/it/test', pretendToBeVisual: true },
  )
  // jsdom 16 (pinned to match Wiki.js) predates replaceChildren, which every
  // browser targeted by the bundle supports (Chrome 86+, Firefox 78+, Safari 14+).
  const proto = (dom.window as unknown as { Element: { prototype: Element }; ShadowRoot: { prototype: ShadowRoot } })
  for (const target of [proto.Element.prototype, proto.ShadowRoot.prototype]) {
    if (!('replaceChildren' in target)) {
      Object.defineProperty(target, 'replaceChildren', {
        value(this: ParentNode & Node, ...nodes: Array<Node | string>) {
          while (this.firstChild) this.removeChild(this.firstChild)
          this.append(...nodes)
        },
      })
    }
  }
  const roots: ShadowRoot[] = []
  const elementProto = (dom.window as unknown as { Element: { prototype: Element } }).Element.prototype
  const attach = elementProto.attachShadow
  elementProto.attachShadow = function (this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init)
    roots.push(root)
    return root
  }
  const calls: Page['calls'] = []
  const fetchStub = async (input: string, init?: RequestInit) => {
    const path = String(input).replace('/psono-connector/api', '')
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, body })
    const json =
      path === '/me/status'
        ? {
            status: 'success',
            pluginEnabled,
            credentialsConfigured: true,
            credentialsExpiresAt: null,
            psonoServer: 'ok',
            loadMode: 'visible',
            passwordVisibleSeconds: 30,
            psonoWeb: normalizePsonoWebBase('https://psono.example.com'),
          }
        : path === '/secrets/otp'
          ? { status: 'success', otp: { code: OTP_CODE, validUntil: new Date(Date.now() + 20_000).toISOString(), periodSeconds: 30 } }
          : { status: 'success', secret }
    return { json: async () => json, status: 200 } as Response
  }
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    fetch: fetchStub,
  }
  for (const [key, value] of Object.entries(globals)) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, key)
    const previous = (globalThis as Record<string, unknown>)[key]
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    restore.push(() => {
      if (had) Object.defineProperty(globalThis, key, { value: previous, configurable: true, writable: true })
      else delete (globalThis as Record<string, unknown>)[key]
    })
  }
  ;(dom.window as unknown as { fetch: unknown }).fetch = fetchStub
  await import('../../src/client/index')
  await new Promise((r) => setTimeout(r, 50))
  return { window: dom.window, calls, roots }
}

const marked = (href: string, id = ID) => `<a href="${href}" class="psono-connector-link" data-psono-secret-id="${id}">x</a>`

describe('browser bundle', () => {
  it('turns a genuine link into a card and resolves it with the canonical URL', async () => {
    const { window, calls } = await loadPage(`<p>${marked(GOOD)}</p>`)
    expect(window.document.querySelectorAll('.psono-connector-host')).toHaveLength(1)
    expect(window.document.querySelectorAll('a.psono-connector-link')).toHaveLength(0)
    const resolve = calls.find((c) => c.path === '/secrets/resolve')
    expect(resolve?.body).toEqual({ url: GOOD })
  })

  it.each([
    ['look-alike host', marked(`https://psono.example.com.evil.example/index.html#!/datastore/search/${ID}`)],
    ['other site entirely', marked('https://evil.example/login')],
    ['id attribute does not match the href', marked(GOOD, '00000000-0000-4000-8000-000000000000')],
    ['javascript: URL', marked('javascript:alert(1)')],
  ])('leaves a forged marked anchor as a plain link: %s', async (_name, html) => {
    const { window, calls } = await loadPage(`<p>${html}</p>`)
    expect(window.document.querySelectorAll('.psono-connector-host')).toHaveLength(0)
    expect(window.document.querySelectorAll('a')).toHaveLength(1)
    expect(window.document.querySelector('a')?.classList.contains('psono-connector-link')).toBe(false)
    expect(calls.some((c) => c.path.startsWith('/secrets/'))).toBe(false)
  })

  it('does nothing when the connector is disabled', async () => {
    const { window, calls } = await loadPage(`<p>${marked(GOOD)}</p>`, false)
    expect(window.document.querySelectorAll('.psono-connector-host')).toHaveLength(0)
    expect(calls.map((c) => c.path)).toEqual(['/me/status'])
  })

  it('does not call the sidecar at all on pages without marked links', async () => {
    const { calls } = await loadPage('<p><a href="https://example.org">x</a></p>')
    expect(calls).toHaveLength(0)
  })
})

describe('OTP show / hide', () => {
  const otpRow = (page: Page) => {
    const dts = [...(page.roots[0]?.querySelectorAll('dt') ?? [])]
    const dt = dts.find((d) => d.textContent === 'Codice OTP')
    const cell = dt?.nextElementSibling as HTMLElement
    const value = cell.querySelector('.otp') as HTMLElement
    const actions = cell?.nextElementSibling as HTMLElement
    const [toggle, copy] = [...actions.querySelectorAll('button')] as HTMLButtonElement[]
    return { value, toggle: toggle!, copy: copy! }
  }
  const settle = () => new Promise((r) => setTimeout(r, 20))

  it('is hidden by default and not fetched until Show', async () => {
    const page = await loadPage(`<p>${marked(GOOD)}</p>`, true, SECRET_WITH_OTP)
    const { value, toggle } = otpRow(page)
    expect(value.textContent).not.toContain(OTP_CODE.slice(0, 3))
    expect(toggle.textContent).toBe('Mostra')
    expect(page.calls.some((c) => c.path === '/secrets/otp')).toBe(false)
  })

  it('Show fetches and displays the code, Hide wipes it', async () => {
    const page = await loadPage(`<p>${marked(GOOD)}</p>`, true, SECRET_WITH_OTP)
    const { value, toggle } = otpRow(page)
    toggle.click()
    await settle()
    expect(value.textContent?.replace(/\D/g, '')).toBe(OTP_CODE)
    expect(toggle.textContent).toBe('Nascondi')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    toggle.click()
    await settle()
    expect(value.textContent).not.toMatch(/\d/)
    expect(toggle.textContent).toBe('Mostra')
    expect(page.roots[0]?.textContent).not.toContain('482')
  })

  it('Copy works while hidden and does not reveal the code on screen', async () => {
    const page = await loadPage(`<p>${marked(GOOD)}</p>`, true, SECRET_WITH_OTP)
    const copied: string[] = []
    Object.defineProperty(page.window.navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true })
    Object.defineProperty(globalThis, 'navigator', { value: page.window.navigator, configurable: true, writable: true })
    const { value, copy } = otpRow(page)
    copy.click()
    await settle()
    expect(copied).toEqual([OTP_CODE])
    expect(value.textContent).not.toMatch(/\d/)
  })

  it('the initial resolve never carries an OTP code', async () => {
    const page = await loadPage(`<p>${marked(GOOD)}</p>`, true, SECRET_WITH_OTP)
    expect(page.calls.filter((c) => c.path === '/secrets/otp')).toHaveLength(0)
    expect(page.calls.filter((c) => c.path === '/secrets/reveal')).toHaveLength(0)
  })
})
