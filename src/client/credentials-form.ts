// SPDX-License-Identifier: AGPL-3.0-only
//
// Form to save / replace / remove the user's Psono API key. Used inside the
// in-page dialog and on the standalone /psono-connector/settings page.
// The stored key is never read back: the UI only knows "configured or not".

import { request, type Status } from './api'
import { h } from './dom'
import type { Strings } from './i18n'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX64 = /^[0-9a-f]{64}$/i

export interface CredentialsFormOptions {
  t: Strings
  /** ISO expiry of this browser's key, or null when this browser has none. */
  expiresAt: string | null
  /** Called after a successful save or delete. */
  onChange: (configured: boolean) => void
  onCancel?: () => void
  /** Show the optional "test with a link" field. */
  withTest?: boolean
}

/** Big warning when the page is not served over HTTPS (keys and secrets would travel in clear text). */
export function httpsAlert(t: Strings): HTMLElement | null {
  if (location.protocol === 'https:') return null
  return h('div', { class: 'msg error alert', role: 'alert' }, h('strong', {}, t.httpsAlertTitle), h('span', {}, t.httpsAlertBody))
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

/** A button that needs a second click within 5 s to act. */
function confirmButton(label: string, confirmLabel: string, action: (button: HTMLButtonElement) => Promise<void>): HTMLButtonElement {
  const button = h('button', { type: 'button' }, label)
  let armed: ReturnType<typeof setTimeout> | null = null
  button.addEventListener('click', async () => {
    if (!armed) {
      button.textContent = confirmLabel
      armed = setTimeout(() => {
        armed = null
        button.textContent = label
      }, 5000)
      return
    }
    clearTimeout(armed)
    armed = null
    button.textContent = label
    button.disabled = true
    await action(button)
    button.disabled = false
  })
  return button
}

export function credentialsForm(options: CredentialsFormOptions): HTMLElement {
  const { t } = options
  const message = h('div', { role: 'status', 'aria-live': 'polite' })
  const show = (text: string, isError = false) => {
    message.replaceChildren(text ? h('div', { class: isError ? 'msg error' : 'msg' }, text) : '')
  }
  const statusLine = h('p', { class: 'muted' })
  const setState = (expiresAt: string | null) => {
    statusLine.textContent = expiresAt ? t.stateConfiguredUntil(formatDate(expiresAt)) : t.stateNotConfigured
    removeHere.hidden = expiresAt === null
  }

  // Write-only fields: no autofill, and hints asking password managers not to
  // capture the key (it would become retrievable there).
  const noCapture = { autocomplete: 'off', spellcheck: 'false', 'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other' }
  const idInput = h('input', { name: 'psono-connector-key-id', ...noCapture, required: true, inputmode: 'text' })
  const secretInput = h('input', { name: 'psono-connector-key-secret', type: 'password', ...noCapture, required: true })

  const saveButton = h('button', { type: 'submit' }, t.save)

  const remove = (scope: 'browser' | 'all') => async () => {
    const result = await request('DELETE', `/me/credentials?scope=${scope}`)
    if (result.status === 'deleted') {
      setState(null)
      show(scope === 'all' ? t.deletedAll : t.deleted)
      options.onChange(false)
    } else {
      show(messageFor(t, result.status), true)
    }
  }
  const removeHere = confirmButton(t.deleteHere, t.confirmDelete, remove('browser'))
  // Always offered: also revokes browsers the user no longer has (lost laptop, old profile).
  const removeEverywhere = confirmButton(t.deleteAll, t.confirmDelete, remove('all'))

  const form = h(
    'form',
    { novalidate: true },
    h('label', {}, t.apiKeyId, idInput),
    h('label', {}, t.apiKeySecretKey, secretInput),
    h(
      'div',
      { class: 'row' },
      saveButton,
      options.onCancel ? h('button', { type: 'button', onclick: () => options.onCancel?.() }, t.cancel) : null,
    ),
    h('div', { class: 'row' }, removeHere, removeEverywhere),
  )
  setState(options.expiresAt)

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const apiKeyId = idInput.value.trim()
    const apiKeySecretKey = secretInput.value.trim()
    if (!UUID.test(apiKeyId) || !HEX64.test(apiKeySecretKey)) {
      show(t.invalidFormat, true)
      return
    }
    saveButton.disabled = true
    const result = await request<{ expiresAt: string }>('PUT', '/me/credentials', { apiKeyId, apiKeySecretKey })
    saveButton.disabled = false
    if (result.status === 'saved') {
      // Drop the values from the DOM as soon as they are stored.
      idInput.value = ''
      secretInput.value = ''
      setState((result as { expiresAt?: string }).expiresAt ?? null)
      show(t.saved)
      options.onChange(true)
    } else {
      show(result.status === 'bad_request' ? t.invalidFormat : messageFor(t, result.status), true)
    }
  })

  const alert = httpsAlert(t)
  const parts: Node[] = [
    ...(alert ? [alert] : []),
    h('p', {}, t.settingsIntro),
    h('p', { class: 'muted' }, t.howTo),
    h('p', { class: 'muted' }, t.perBrowser),
    statusLine,
    h('p', { class: 'muted' }, t.writeOnly),
    form,
  ]

  if (options.withTest) {
    const linkInput = h('input', { name: 'url', type: 'url', autocomplete: 'off', spellcheck: 'false' })
    const testButton = h('button', { type: 'button' }, t.test)
    testButton.addEventListener('click', async () => {
      const url = linkInput.value.trim()
      if (!url) return
      testButton.disabled = true
      const result = await request('POST', '/me/credentials/test', { url })
      testButton.disabled = false
      show(result.status === 'success' ? t.testOk : messageFor(t, result.status), result.status !== 'success')
    })
    parts.push(h('div', { class: 'row' }, h('label', { style: 'flex:1' }, t.testLink, linkInput), testButton))
  }
  parts.push(message)
  return h('div', {}, ...parts)
}

export function messageFor(t: Strings, status: string): string {
  switch (status) {
    case 'not_configured':
      return t.notConfigured
    case 'forbidden':
      return t.forbidden
    case 'invalid_credentials':
      return t.invalidCredentials
    case 'unavailable':
      return t.unavailable
    case 'server_changed':
      return t.serverChanged
    case 'unauthenticated':
    case 'forbidden_origin':
      return t.unauthenticated
    case 'rate_limited':
      return t.rateLimited
    case 'disabled':
      return t.disabled
    default:
      return t.error
  }
}

export type { Status }
