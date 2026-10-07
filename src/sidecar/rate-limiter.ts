// SPDX-License-Identifier: AGPL-3.0-only
//
// Fixed-window, in-memory rate limiter keyed by "<bucket>:<wiki user id>".
// Single-process by design (one sidecar per wiki); state resets on restart.

export interface Limit {
  max: number
  windowMs: number
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private lastSweep = 0

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns true if the call is allowed. */
  take(key: string, limit: Limit): boolean {
    const now = this.now()
    this.sweep(now)
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + limit.windowMs })
      return true
    }
    if (entry.count >= limit.max) return false
    entry.count++
    return true
  }

  /** True if `key` has already used up its window, without consuming a hit. */
  exhausted(key: string, limit: Limit): boolean {
    const entry = this.hits.get(key)
    return entry !== undefined && entry.resetAt > this.now() && entry.count >= limit.max
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return
    this.lastSweep = now
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
  }
}
