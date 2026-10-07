# ADR-0003: User identity is delegated to Wiki.js via public GraphQL

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)

## Decision

For each request the sidecar reads the `jwt` cookie (same origin) and calls
Wiki.js `POST /graphql` with `Authorization: Bearer <jwt>` and
`query { users { profile { id } } }`. Wiki.js itself throws `AuthRequired` for
guests and invalid tokens and `AuthAccountBanned` for deactivated users
(`UserProfile` has no `isActive` field), so any GraphQL error, a missing
profile or the guest id 2 means "not signed in". The Wiki.js user id from that answer
is the only identity used; nothing identifying the user is accepted from the
browser.

The result may be cached in memory for a few seconds per token hash to absorb
OTP refreshes; never persisted. Wiki.js error bodies are never relayed.

## Rejected alternatives

- Verifying the RS256 JWT locally with the public key from the Wiki.js
  `settings` table: couples us to the DB schema and misses revocation and
  deactivated-account checks.
- In-process `WIKI.auth`: see ADR-0001.

## CSRF

State-changing and secret-returning routes require `POST`,
`Content-Type: application/json`, a custom header
(`X-Psono-Connector: 1`) and an `Origin`/`Sec-Fetch-Site` same-origin check.
