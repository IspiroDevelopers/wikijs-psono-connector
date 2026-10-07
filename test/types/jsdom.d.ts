// SPDX-License-Identifier: AGPL-3.0-only
// jsdom is pinned to 16.4.0 to match Wiki.js 2.5; only the API used in tests.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: Window & typeof globalThis
  }
}
