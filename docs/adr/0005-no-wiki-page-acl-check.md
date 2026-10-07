# ADR-0005: No Wiki.js page-permission check on secret resolution

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Supersedes: spec v1 §12 "utente autorizzato a vedere la pagina"

## Context

Wiki.js 2.x has no read-level GraphQL query to check page access
(`pages.singleByPath` requires `manage:pages`).

## Decision

Resolution is authorized by: authenticated Wiki.js user ∧ connector enabled ∧
user has stored an API key ∧ Psono grants that key access to the secret.

The page-level check adds no security: a user can only ever resolve secrets
that their **own** Psono API key already grants, and could do so directly in
Psono. The request carries a secret id, not a page.

## Consequences

Simpler, no dependency on internal permission APIs. Revisit if Wiki.js adds a
read-permission query (e.g. in 3.x).
