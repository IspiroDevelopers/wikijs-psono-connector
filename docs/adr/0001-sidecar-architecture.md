# ADR-0001: Backend as a sidecar service behind a reverse proxy

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Supersedes: spec v1 §2 "no external middleware", §21.2 image patching

## Context

The connector needs backend routes, per-user encrypted storage and migrations.
Wiki.js 2.x exposes none of these as an extension API (see
`docs/research-wikijs.md`). The only in-process hook (`modules/extensions`)
runs after the 404 handler, so routes would require splicing Express internals,
and the connector would run with full access to the Wiki.js process and DB.

## Decision

Ship three independent parts:

1. **Rendering module** `html-psono-connector`, bind-mounted into
   `/wiki/server/modules/rendering/`. It only rewrites matching anchors.
2. **Frontend bundle**, loaded by a single `<script>` tag via Admin → Theme →
   Code Injection (served by the sidecar under the same origin).
3. **Sidecar service** (`psono-connector`, Node.js, own container), reachable
   only through a reverse proxy at `/psono-connector/*` on the Wiki.js origin.
   It owns its database schema, the master key and all Psono traffic.

The reverse proxy (Caddy reference config) terminates TLS and routes
`/psono-connector/*` to the sidecar and everything else to Wiki.js.

## Consequences

- No Wiki.js file is modified or patched; upgrading the Wiki.js image never
  touches the connector. The contract surface is: public GraphQL
  (`users.profile`), the rendering-module format, and code injection.
- The master key and decrypted secrets never enter the Wiki.js process.
- A crash or bug in the connector cannot take the wiki down.
- Installation needs a reverse proxy. Most production Wiki.js installs already
  have one; we provide a compose example that includes it.
- The sidecar uses its own PostgreSQL schema (or its own DB), never Wiki.js
  tables.
