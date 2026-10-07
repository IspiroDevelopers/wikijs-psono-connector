// SPDX-License-Identifier: AGPL-3.0-only
//
// One credential card, replacing one marked anchor. Rendered in a shadow root
// so Wiki.js styles cannot leak in and page scripts cannot query its content by
// accident. Secret values only ever live in text nodes and in-memory variables.

import { isSuccess, request, type Otp, type SecretSummary, type Status } from './api'
import { credentialsForm, messageFor } from './credentials-form'
import { h, isDarkTheme, safeHref } from './dom'
import type { Strings } from './i18n'
import { KEY_ICON, STYLES } from './styles'

export interface CardContext {
  t: Strings
  status(): Promise<Status | null>
  /** Shared, page-scoped, in-memory de-duplication of resolve calls. */
  resolve(url: string, signal: AbortSignal): Promise<{ status: string; secret?: SecretSummary }>
  /** Re-render every card, e.g. after the user saved an API key. */
  refreshAll(): void
}

const OTP_MARGIN_MS = 400
const PASSWORD_MASK = '••••••••••'
const OTP_MASK = '••• •••'

function keyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', 'icon')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', KEY_ICON)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export class PsonoCard {
  readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly body: HTMLElement
  private readonly url: string
  private readonly label: string
  private controller = new AbortController()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private otpValue: HTMLElement | null = null
  private otpCountdown: HTMLElement | null = null
  private otpToggle: HTMLButtonElement | null = null
  private otpValidUntil = 0
  private otpCode: string | null = null
  private otpShown = false
  private visible = false
  private loaded = false
  private passwordText: Text | null = null
  // Bumped on every show/hide: timers from an earlier show become no-ops.
  private otpGeneration = 0
  private passwordGeneration = 0

  /**
   * @param canonicalUrl Psono link rebuilt from the validated secret id. The
   *   anchor's own href is never used: a hand-written anchor could point to a
   *   look-alike site behind an "Open in Psono" button.
   */
  constructor(anchor: HTMLAnchorElement, canonicalUrl: string, private readonly ctx: CardContext) {
    this.url = canonicalUrl
    this.label = (anchor.textContent ?? '').trim()
    this.host = h('span', { class: 'psono-connector-host', 'data-psono-secret-id': anchor.dataset.psonoSecretId })
    this.host.dataset.theme = isDarkTheme() ? 'dark' : 'light'
    this.root = this.host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = STYLES
    this.body = h('div', { class: 'card', role: 'group', 'aria-label': ctx.t.credential })
    this.root.append(style, this.body)
    anchor.replaceWith(this.host)
    this.renderIdle()
  }

  // ------------------------------------------------------------ lifecycle

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) this.refreshOtpIfStale()
  }

  onPageVisible(): void {
    if (this.visible) this.refreshOtpIfStale()
  }

  /** Abort requests, stop timers and wipe secret text. */
  dispose(): void {
    this.controller.abort()
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    this.hidePassword()
    this.hideOtp()
    this.body.replaceChildren()
  }

  reset(): void {
    this.dispose()
    this.controller = new AbortController()
    this.loaded = false
    this.host.dataset.theme = isDarkTheme() ? 'dark' : 'light'
    this.renderIdle()
  }

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timers.delete(id)
      fn()
    }, Math.max(0, ms))
    this.timers.add(id)
  }

  // ------------------------------------------------------------ rendering

  private header(title: string, muted = false): HTMLElement {
    return h('div', { class: 'head' }, keyIcon(), h('span', { class: muted ? 'title muted' : 'title' }, title))
  }

  private openInPsono(): HTMLElement {
    return h('a', { class: 'btn', href: this.url, target: '_blank', rel: 'noopener noreferrer' }, this.ctx.t.openInPsono)
  }

  private renderIdle(): void {
    const { t } = this.ctx
    this.body.replaceChildren(this.header(this.label || t.credential), h('div', { class: 'skeleton', 'aria-hidden': 'true' }), h('span', { class: 'sr' }, t.waiting))
  }

  /** Called by the observer (visible mode) or immediately (click mode shows a button). */
  async load(mode: 'visible' | 'click' = 'visible'): Promise<void> {
    if (this.loaded) return
    const { t } = this.ctx
    if (mode === 'click') {
      this.body.replaceChildren(
        this.header(this.label || t.credential),
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => void this.fetchAndRender() }, t.load), this.openInPsono()),
      )
      return
    }
    await this.fetchAndRender()
  }

  private async fetchAndRender(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const { t } = this.ctx
    this.body.replaceChildren(this.header(this.label || t.credential), h('div', { class: 'skeleton' }), h('span', { class: 'sr', role: 'status' }, t.loading))
    const result = await this.ctx.resolve(this.url, this.controller.signal)
    if (result.status === 'aborted') return
    if (result.status === 'success' && result.secret) this.renderSecret(result.secret)
    else this.renderFailure(result.status)
  }

  private renderFailure(status: string): void {
    const { t } = this.ctx
    const actions: HTMLElement[] = []
    if (status === 'not_configured') {
      actions.push(h('button', { type: 'button', onclick: () => void this.openDialog() }, t.configure))
    } else if (status === 'unavailable' || status === 'error' || status === 'rate_limited') {
      actions.push(
        h('button', {
          type: 'button',
          onclick: () => {
            this.reset()
            void this.fetchAndRender()
          },
        }, t.retry),
      )
    }
    // The user can always replace or remove their key from any card — above
    // all when Psono denies access or the key is invalid.
    const manage = this.manageKeyButton(status)
    if (manage) actions.push(manage)
    actions.push(this.openInPsono())
    const isError = status !== 'not_configured'
    this.body.replaceChildren(
      this.header(this.label || t.credential),
      h('div', { class: isError ? 'msg error' : 'msg', role: 'status' }, messageFor(t, status)),
      h('div', { class: 'row' }, ...actions),
    )
  }

  /** "Manage API key" button, or null where it cannot apply (no session, connector off, no key yet). */
  private manageKeyButton(status = 'success'): HTMLElement | null {
    if (['unauthenticated', 'forbidden_origin', 'disabled', 'not_configured'].includes(status)) return null
    return h('button', { type: 'button', onclick: () => void this.openDialog() }, this.ctx.t.manageKey)
  }

  private renderSecret(secret: SecretSummary): void {
    const { t } = this.ctx
    if (secret.type === 'unsupported') {
      this.body.replaceChildren(this.header(secret.title || this.label || t.credential), h('p', { class: 'muted' }, t.unsupportedType), h('div', { class: 'row' }, this.manageKeyButton(), this.openInPsono()))
      return
    }
    const rows: Node[] = []
    const row = (label: string, value: Node, actions: Node[] = [], valueClass = 'value') => {
      rows.push(h('dt', {}, label), h('dd', { class: valueClass }, value), h('dd', { class: 'actions' }, ...actions))
    }

    if (secret.url) {
      const href = safeHref(secret.url)
      const actions: Node[] = []
      if (href) actions.push(h('a', { class: 'btn', href, target: '_blank', rel: 'noopener noreferrer' }, t.open))
      actions.push(this.copyButton(() => Promise.resolve(secret.url ?? null), `${t.copy} ${t.url}`))
      row(t.url, document.createTextNode(secret.url), actions)
    }
    if (secret.username) {
      row(t.username, document.createTextNode(secret.username), [this.copyButton(() => Promise.resolve(secret.username ?? null), `${t.copy} ${t.username}`)])
    }
    if (secret.hasPassword) {
      const value = h('span', { 'aria-live': 'off' }, PASSWORD_MASK)
      const toggle = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${t.show} ${t.password}` }, t.show)
      toggle.addEventListener('click', async () => {
        if (this.passwordText) {
          this.hidePassword(value, toggle)
          return
        }
        toggle.disabled = true
        const password = await this.revealPassword()
        toggle.disabled = false
        if (password === null) return
        const generation = ++this.passwordGeneration
        this.passwordText = document.createTextNode(password)
        value.replaceChildren(this.passwordText)
        toggle.textContent = t.hide
        toggle.setAttribute('aria-label', `${t.hide} ${t.password}`)
        toggle.setAttribute('aria-pressed', 'true')
        void this.autoHideAfter(() => {
          if (generation === this.passwordGeneration) this.hidePassword(value, toggle)
        })
      })
      row(t.password, value, [toggle, this.copyButton(() => this.revealPassword(), `${t.copy} ${t.password}`)])
    }
    if (secret.hasOtp) {
      // Hidden by default, like the password: the code is fetched only on Show
      // (or Copy) and refreshed only while shown and on screen.
      this.otpValue = h('span', { class: 'otp', 'aria-live': 'off' }, OTP_MASK)
      this.otpCountdown = h('span', { class: 'countdown', 'aria-hidden': 'true' })
      const toggle = h('button', { type: 'button', 'aria-pressed': 'false', 'aria-label': `${t.show} ${t.otp}` }, t.show)
      this.otpToggle = toggle
      toggle.addEventListener('click', async () => {
        if (this.otpShown) {
          this.hideOtp()
          return
        }
        toggle.disabled = true
        await this.showOtp()
        toggle.disabled = false
      })
      row(t.otp, h('span', {}, this.otpValue, this.otpCountdown), [toggle, this.copyButton(() => this.otpForCopy(), `${t.copy} ${t.otp}`)])
    }
    if (secret.notes) {
      rows.push(h('dt', {}, t.notes), h('dd', { class: 'notes' }, secret.notes))
    }

    this.body.replaceChildren(
      h('div', { class: 'head' }, keyIcon(), h('span', { class: 'title' }, secret.title || this.label || t.credential), this.manageKeyButton(), this.openInPsono()),
      h('dl', {}, ...rows),
    )
  }

  private copyButton(getValue: () => Promise<string | null>, label: string): HTMLButtonElement {
    const { t } = this.ctx
    const button = h('button', { type: 'button', 'aria-label': label }, t.copy)
    button.addEventListener('click', async () => {
      const value = await getValue()
      if (value === null) return
      if (await copyText(value)) {
        button.textContent = t.copied
        this.later(() => (button.textContent = t.copy), 1500)
      }
    })
    return button
  }

  private async revealPassword(): Promise<string | null> {
    const result = await request<{ password: string }>('POST', '/secrets/reveal', { url: this.url }, this.controller.signal)
    if (isSuccess(result)) return result.password
    if (result.status !== 'aborted') this.renderFailure(result.status)
    return null
  }

  private hidePassword(value?: HTMLElement, toggle?: HTMLButtonElement): void {
    if (this.passwordText) {
      this.passwordText.data = ''
      this.passwordText = null
    }
    this.passwordGeneration++
    if (value) value.replaceChildren(PASSWORD_MASK)
    if (toggle) {
      toggle.textContent = this.ctx.t.show
      toggle.setAttribute('aria-label', `${this.ctx.t.show} ${this.ctx.t.password}`)
      toggle.setAttribute('aria-pressed', 'false')
    }
  }

  /** Runs `hide` after the admin-configured visibility window. */
  private async autoHideAfter(hide: () => void): Promise<void> {
    const status = await this.ctx.status()
    this.later(hide, (status?.passwordVisibleSeconds ?? 30) * 1000)
  }

  // ------------------------------------------------------------ OTP

  private async fetchOtp(): Promise<Otp | null> {
    const result = await request<{ otp: Otp }>('POST', '/secrets/otp', { url: this.url }, this.controller.signal)
    if (isSuccess(result)) return result.otp
    if (result.status !== 'aborted' && result.status !== 'no_otp') this.renderFailure(result.status)
    return null
  }

  private async showOtp(): Promise<void> {
    const otp = await this.fetchOtp()
    if (!otp || !this.otpToggle) return
    const generation = ++this.otpGeneration
    this.otpShown = true
    const { t } = this.ctx
    this.otpToggle.textContent = t.hide
    this.otpToggle.setAttribute('aria-label', `${t.hide} ${t.otp}`)
    this.otpToggle.setAttribute('aria-pressed', 'true')
    this.displayOtp(otp, generation)
    void this.autoHideAfter(() => {
      if (generation === this.otpGeneration) this.hideOtp()
    })
  }

  private displayOtp(otp: Otp, generation: number): void {
    if (!this.otpValue || generation !== this.otpGeneration || !this.otpShown) return
    this.otpCode = otp.code
    this.otpValue.textContent = otp.code.length === 6 ? `${otp.code.slice(0, 3)} ${otp.code.slice(3)}` : otp.code
    this.otpValidUntil = Date.parse(otp.validUntil)
    this.tickCountdown(generation)
    // Next code right after the period boundary, not with a drifting interval.
    this.later(() => {
      if (generation === this.otpGeneration && this.visible && document.visibilityState === 'visible') void this.refreshOtp(generation)
    }, this.otpValidUntil - Date.now() + OTP_MARGIN_MS)
  }

  private tickCountdown(generation: number): void {
    if (!this.otpCountdown || generation !== this.otpGeneration) return
    const left = Math.max(0, Math.ceil((this.otpValidUntil - Date.now()) / 1000))
    this.otpCountdown.textContent = this.ctx.t.secondsLeft(left)
    if (left > 0) this.later(() => this.tickCountdown(generation), 1000)
  }

  private otpInFlight = false

  private async refreshOtp(generation: number): Promise<void> {
    if (this.otpInFlight) return
    this.otpInFlight = true
    const otp = await this.fetchOtp()
    this.otpInFlight = false
    if (otp) this.displayOtp(otp, generation)
  }

  /** When the card or tab comes back into view with an expired code on screen. */
  private refreshOtpIfStale(): void {
    if (this.otpShown && Date.now() >= this.otpValidUntil) void this.refreshOtp(this.otpGeneration)
  }

  /** Copy works while hidden too: it fetches a fresh code without displaying it. */
  private async otpForCopy(): Promise<string | null> {
    if (this.otpShown && this.otpCode && Date.now() < this.otpValidUntil) return this.otpCode
    return (await this.fetchOtp())?.code ?? null
  }

  private hideOtp(): void {
    this.otpGeneration++
    this.otpShown = false
    this.otpCode = null
    this.otpValidUntil = 0
    if (this.otpValue) this.otpValue.textContent = OTP_MASK
    if (this.otpCountdown) this.otpCountdown.textContent = ''
    if (this.otpToggle) {
      const { t } = this.ctx
      this.otpToggle.textContent = t.show
      this.otpToggle.setAttribute('aria-label', `${t.show} ${t.otp}`)
      this.otpToggle.setAttribute('aria-pressed', 'false')
    }
  }

  // ------------------------------------------------------------ dialog

  private async openDialog(): Promise<void> {
    const { t } = this.ctx
    const status = await this.ctx.status()
    const dialog = h('dialog', { 'aria-label': t.settingsTitle })
    const close = () => {
      dialog.close()
      dialog.remove()
    }
    dialog.append(
      h('h2', {}, t.settingsTitle),
      credentialsForm({
        t,
        expiresAt: status?.credentialsExpiresAt ?? null,
        // Saved or removed: every card on the page reloads with the new state.
        onChange: () => {
          close()
          this.ctx.refreshAll()
        },
        onCancel: close,
      }),
    )
    dialog.addEventListener('cancel', () => dialog.remove())
    this.root.append(dialog)
    dialog.showModal()
  }

}
