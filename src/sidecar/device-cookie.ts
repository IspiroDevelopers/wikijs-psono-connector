// SPDX-License-Identifier: AGPL-3.0-only
//
// The browser half of a device-bound key (ADR-0008). The cookie is HttpOnly,
// so no script on the wiki origin can read or exfiltrate it; SameSite=Strict
// and Path=/psono-connector/ keep it off every other request.

import { DEVICE_SECRET_BYTES } from './crypto/credential-cipher'
import type { DeviceToken } from './db/credential-store'

export const DEVICE_COOKIE = 'psono_connector_device'
const COOKIE_PATH = '/psono-connector/'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const B64URL_SECRET = new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((DEVICE_SECRET_BYTES * 4) / 3)}}$`)

/** Returns the value of cookie `name` from a Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export function readDeviceToken(header: string | undefined): DeviceToken | null {
  const value = readCookie(header, DEVICE_COOKIE)
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot < 0) return null
  const deviceId = value.slice(0, dot)
  const secret = value.slice(dot + 1)
  if (!UUID.test(deviceId) || !B64URL_SECRET.test(secret)) return null
  const deviceSecret = Buffer.from(secret, 'base64url')
  if (deviceSecret.length !== DEVICE_SECRET_BYTES) return null
  return { deviceId, deviceSecret }
}

function attributes(secure: boolean): string[] {
  return [`Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Strict', ...(secure ? ['Secure'] : [])]
}

export function deviceCookie(token: DeviceToken, expiresAt: Date, secure: boolean, now = new Date()): string {
  const maxAge = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000))
  return [
    `${DEVICE_COOKIE}=${token.deviceId}.${token.deviceSecret.toString('base64url')}`,
    `Max-Age=${maxAge}`,
    `Expires=${expiresAt.toUTCString()}`,
    ...attributes(secure),
  ].join('; ')
}

export function clearDeviceCookie(secure: boolean): string {
  return [`${DEVICE_COOKIE}=`, 'Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT', ...attributes(secure)].join('; ')
}
