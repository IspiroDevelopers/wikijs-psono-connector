// SPDX-License-Identifier: AGPL-3.0-only
//
// Browser → sidecar calls. Same origin only; the Wiki.js `jwt` cookie travels
// automatically. Nothing is cached outside of memory.

import type { PsonoWebBase } from '../shared/psono-reference'

export const API = '/psono-connector/api'

export interface Status {
  status: 'success'
  pluginEnabled: boolean
  credentialsConfigured: boolean
  credentialsExpiresAt: string | null
  /** 'changed': the Psono server no longer proves its pinned identity. */
  psonoServer: 'ok' | 'changed' | 'unknown'
  loadMode: 'visible' | 'click'
  passwordVisibleSeconds: number
  psonoWeb: PsonoWebBase
}

export interface Otp {
  code: string
  validUntil: string
  periodSeconds: number
}

export interface SecretSummary {
  type: string
  title: string
  url?: string
  username?: string
  notes?: string
  hasPassword: boolean
  hasOtp: boolean
}

export type ApiResult<T> = ({ status: 'success' } & T) | { status: string }

export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal): Promise<ApiResult<T>> {
  let response: Response
  try {
    const init: RequestInit = {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'x-psono-connector': '1',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)
    if (signal) init.signal = signal
    response = await fetch(`${API}${path}`, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { status: 'aborted' }
    return { status: 'unavailable' }
  }
  try {
    return (await response.json()) as ApiResult<T>
  } catch {
    return { status: response.status === 401 ? 'unauthenticated' : 'error' }
  }
}

export function isSuccess<T>(r: ApiResult<T>): r is { status: 'success' } & T {
  return r.status === 'success'
}
