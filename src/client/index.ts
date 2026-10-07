// SPDX-License-Identifier: AGPL-3.0-only
//
// Browser bundle. Loaded on every wiki page by one <script> tag (Admin →
// Theme → Code Injection). It does nothing unless the page contains links the
// rendering module marked, and nothing unless the sidecar says the connector
// is enabled. It also renders the /psono-connector/settings page.

import { isSuccess, request, type Otp, type SecretSummary, type Status } from './api'
import { PsonoCard, type CardContext } from './card'
import { credentialsForm, messageFor } from './credentials-form'
import { h, isDarkTheme } from './dom'
import { strings } from './i18n'
import { STYLES } from './styles'
import { parsePsonoReference, psonoSecretUrl } from '../shared/psono-reference'

const LINK_SELECTOR = 'a.psono-connector-link[data-psono-secret-id]'

type ResolveResult = { status: string; secret?: SecretSummary }

function createContext(): { ctx: CardContext; cards: Set<PsonoCard> } {
  const t = strings()
  const cards = new Set<PsonoCard>()
  let statusPromise: Promise<Status | null> | null = null
  // Page-scoped, memory-only de-duplication of concurrent resolves.
  const inflight = new Map<string, Promise<ResolveResult>>()

  const ctx: CardContext = {
    t,
    status() {
      statusPromise ??= request<Omit<Status, 'status'>>('GET', '/me/status').then((r) => (isSuccess(r) ? (r as Status) : null))
      return statusPromise
    },
    async resolve(url, signal) {
      const status = await ctx.status()
      if (!status) return { status: 'unauthenticated' }
      // A server that cannot prove its identity wins over "configure your key": do not invite users to enter one.
      if (status.psonoServer === 'changed') return { status: 'server_changed' }
      if (!status.credentialsConfigured) return { status: 'not_configured' }
      let p = inflight.get(url)
      if (!p) {
        p = request<{ secret: SecretSummary }>('POST', '/secrets/resolve', { url }, signal)
        inflight.set(url, p)
        void p.finally(() => inflight.delete(url))
      }
      return p
    },
    refreshAll() {
      statusPromise = null
      for (const card of cards) {
        card.reset()
        void ctx.status().then((s) => card.load(s?.loadMode ?? 'visible'))
      }
    },
  }
  return { ctx, cards }
}

function enhancePage(): void {
  const { ctx, cards } = createContext()
  let enabledChecked: Promise<Status | null> | null = null

  const nearObserver =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              nearObserver?.unobserve(entry.target)
              const card = [...cards].find((c) => c.host === entry.target)
              if (card) void ctx.status().then((s) => card.load(s?.loadMode ?? 'visible'))
            }
          },
          { rootMargin: '200px' },
        )
      : null
  const visibleObserver =
    'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const card = [...cards].find((c) => c.host === entry.target)
            card?.setVisible(entry.isIntersecting)
          }
        })
      : null

  async function scan(): Promise<void> {
    const anchors = document.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)
    if (anchors.length === 0) return
    // Ask the sidecar once; when disabled or unreachable, leave links as plain links.
    enabledChecked ??= ctx.status()
    const status = await enabledChecked
    if (!status?.pluginEnabled) {
      if (status === null) enabledChecked = null // e.g. not signed in yet; try again on next scan
      return
    }
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR)) {
      if (!anchor.isConnected) continue
      // Re-validate client-side with the same parser as the renderer and the
      // sidecar. Anything else (e.g. a hand-written anchor carrying the marker
      // class but pointing elsewhere) stays a plain, unstyled link.
      const reference = parsePsonoReference(anchor.getAttribute('href') ?? '', status.psonoWeb)
      if (!reference || reference.secretId !== anchor.dataset.psonoSecretId?.toLowerCase()) {
        anchor.classList.remove('psono-connector-link')
        continue
      }
      const card = new PsonoCard(anchor, psonoSecretUrl(status.psonoWeb, reference.secretId), ctx)
      cards.add(card)
      if (nearObserver && visibleObserver) {
        nearObserver.observe(card.host)
        visibleObserver.observe(card.host)
      } else {
        card.setVisible(true)
        void card.load(status.loadMode)
      }
    }
  }

  // Wiki.js renders page content client-side (Vue), so links can appear after load.
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      void scan()
    })
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  schedule()

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') for (const card of cards) card.onPageVisible()
  })
  // Leaving the page: abort requests, stop timers, wipe secret text.
  window.addEventListener('pagehide', () => {
    for (const card of cards) card.dispose()
  })
  // Back/forward cache restore: cards were wiped on pagehide, load them again.
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) ctx.refreshAll()
  })
}

async function renderSettingsPage(mount: HTMLElement): Promise<void> {
  const t = strings()
  const root = mount.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLES
  mount.dataset.theme = isDarkTheme() ? 'dark' : 'light'
  const card = h('div', { class: 'card' }, h('h2', {}, t.settingsTitle))
  root.append(style, card)

  const status = await request<Omit<Status, 'status'>>('GET', '/me/status')
  if (!isSuccess(status)) {
    card.append(h('div', { class: 'msg error' }, messageFor(t, status.status)))
    return
  }
  const s = status as Status
  if (!s.pluginEnabled) card.append(h('div', { class: 'msg' }, t.disabled))
  card.append(credentialsForm({ t, expiresAt: s.credentialsExpiresAt, onChange: () => {}, withTest: true }))
}

function boot(): void {
  const settings = document.getElementById('psono-connector-settings')
  if (settings) void renderSettingsPage(settings)
  else enhancePage()
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()
