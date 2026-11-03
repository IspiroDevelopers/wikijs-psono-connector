// SPDX-License-Identifier: AGPL-3.0-only
//
// Maps a decrypted Psono secret to the few fields the connector may show.
// Allow-list only: unknown types and fields (SSH keys, card numbers, ...) never
// leave the sidecar. Custom fields are shown by name; text fields with their
// value, every other kind (password) only on explicit request, like the password. Field names come from
// psono-client src/js/services/item-blueprint.js (see docs/research-psono.md).

import { parseTotpParams, type TotpParams } from './totp'

export type SupportedType = 'website_password' | 'application_password' | 'totp' | 'bookmark' | 'note'

/** Safe to send to the browser on initial load. */
export interface CustomFieldSummary {
  name: string
  /** Text fields only. */
  value?: string
  /** Hidden fields only: position in the secret, to reveal the value on request. */
  hiddenIndex?: number
}

export interface SecretSummary {
  type: SupportedType | 'unsupported'
  title: string
  url?: string
  username?: string
  notes?: string
  customFields?: CustomFieldSummary[]
  hasPassword: boolean
  hasOtp: boolean
}

export interface MappedSecret {
  summary: SecretSummary
  /** Sent only by the explicit reveal endpoint. */
  password?: string
  /** Never sent to the browser. */
  totp?: TotpParams
  /** Values of the hidden custom fields, by position. Sent only by the explicit field endpoint. */
  hiddenFields?: Map<number, { name: string; value: string }>
}

const MAX_FIELD_LENGTH = 10_000
const MAX_CUSTOM_FIELDS = 50
const MAX_CUSTOM_FIELD_NAME_LENGTH = 200

function text(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value
  return trimmed === '' ? undefined : trimmed
}

/** Only http(s) URLs are ever returned; anything else is dropped. */
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Custom fields of the secret. A field without a type is a text field (older
 * Psono versions); anything other than "text" is treated as secret.
 */
function mapCustomFields(value: unknown): { shown: CustomFieldSummary[]; hidden: Map<number, { name: string; value: string }> } {
  const shown: CustomFieldSummary[] = []
  const hidden = new Map<number, { name: string; value: string }>()
  if (!Array.isArray(value)) return { shown, hidden }
  value.slice(0, MAX_CUSTOM_FIELDS).forEach((field: unknown, index) => {
    if (typeof field !== 'object' || field === null) return
    const f = field as Record<string, unknown>
    const fieldValue = text(f, 'value')
    if (typeof f.name !== 'string' || f.name === '' || fieldValue === undefined) return
    const name = f.name.slice(0, MAX_CUSTOM_FIELD_NAME_LENGTH)
    if (f.type === undefined || f.type === 'text') {
      shown.push({ name, value: fieldValue })
    } else {
      shown.push({ name, hiddenIndex: index })
      hidden.set(index, { name, value: fieldValue })
    }
  })
  return { shown, hidden }
}

function detectType(data: Record<string, unknown>): SupportedType | null {
  for (const type of ['website_password', 'application_password', 'totp', 'bookmark', 'note'] as const) {
    if (`${type}_title` in data) return type
  }
  return null
}

function withOptional<T extends object>(base: T, extra: Record<string, string | undefined>): T {
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) (base as Record<string, unknown>)[key] = value
  }
  return base
}

export function mapSecret(data: unknown): MappedSecret {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { summary: { type: 'unsupported', title: '', hasPassword: false, hasOtp: false } }
  }
  const d = data as Record<string, unknown>
  const type = detectType(d)
  if (!type) {
    const title = Object.keys(d)
      .filter((k) => k.endsWith('_title'))
      .map((k) => text(d, k))
      .find(Boolean)
    return { summary: { type: 'unsupported', title: title ?? '', hasPassword: false, hasOtp: false } }
  }

  const password = type === 'website_password' || type === 'application_password' ? text(d, `${type}_password`) : undefined
  const totp =
    type === 'website_password'
      ? parseTotpParams(d.website_password_totp_code, d.website_password_totp_period, d.website_password_totp_digits, d.website_password_totp_algorithm)
      : type === 'totp'
        ? parseTotpParams(d.totp_code, d.totp_period, d.totp_digits, d.totp_algorithm)
        : null

  const summary = withOptional<SecretSummary>(
    {
      type,
      title: text(d, `${type}_title`) ?? '',
      hasPassword: password !== undefined,
      hasOtp: totp !== null,
    },
    {
      url: type === 'website_password' || type === 'bookmark' ? safeUrl(text(d, `${type}_url`)) : undefined,
      username: type === 'website_password' || type === 'application_password' ? text(d, `${type}_username`) : undefined,
      notes: text(d, `${type}_notes`),
    },
  )

  const customFields = type === 'website_password' || type === 'application_password' || type === 'note' || type === 'bookmark' ? mapCustomFields(d.custom_fields) : null
  if (customFields && customFields.shown.length > 0) summary.customFields = customFields.shown

  const mapped: MappedSecret = { summary }
  if (customFields && customFields.hidden.size > 0) mapped.hiddenFields = customFields.hidden
  if (password !== undefined) mapped.password = password
  if (totp) mapped.totp = totp
  return mapped
}
