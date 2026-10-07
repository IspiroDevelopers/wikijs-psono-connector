# Architecture

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Why each choice was made is recorded in the [ADRs](adr/README.md); the risks are
in the [threat model](threat-model.md). This page is the map.

## Components

```text
                       ┌───────────────────────── your reverse proxy (TLS) ─────────────────────────┐
 Browser ──HTTPS────►  │  /psono-connector/*  ──►  sidecar :3100        everything else ──► Wiki.js │
                       └─────────────────────────────────────────────────────────────────────────────┘

 Wiki.js 2.x (unmodified)                       Sidecar (this project, Node.js)            Psono server
 ├─ rendering module  (src/renderer)            ├─ HTTP API + static client (src/sidecar)   (HTTPS, pinned)
 │   marks links to your Psono                  ├─ Wiki.js identity  ──GraphQL──► Wiki.js
 └─ <script> tag ──► client.js (src/client)     ├─ credential store ──► its own PostgreSQL
                                                └─ Psono client ─────────────────────────► /api-key-access/secret/
```

| Part | Source | Runs | Responsibility |
|---|---|---|---|
| Rendering module | `src/renderer`, `wikijs-module/` | inside Wiki.js, at page save | turn links to *your* Psono into marked `<a>` elements. Never contacts Psono, never emits secrets. |
| Browser bundle | `src/client` | in the reader's browser | replace marked links with cards; lazy loading, Show/Hide, copy, OTP refresh, key dialog. Re-validates every link. |
| Sidecar | `src/sidecar` | container | identity, per-browser encrypted keys, Psono access, field filtering, audit log |
| Shared | `src/shared` | all three | the URL matcher (`psono-reference.ts`) — one implementation, three consumers |

## Request flow: showing a credential

1. A reader opens a page. The bundle finds `a.psono-connector-link` anchors and
   re-validates each against the Psono web URL from `/me/status`; forged anchors
   stay plain links.
2. `GET /me/status`: the sidecar asks Wiki.js (`users.profile`, with the reader's
   own JWT) who the user is, reports whether this browser has a key, the connector
   switch, and the Psono server's identity check.
3. When a card nears the viewport: `POST /secrets/resolve { url }`. The sidecar
   - re-parses the URL with the shared matcher (exact host/port/path, UUID),
   - verifies the pinned Psono identity (cached),
   - reads the browser's device cookie, derives the key
     `HKDF(master key, device secret)` and decrypts that browser's API key,
   - calls `POST /api-key-access/secret/ { api_key_id, secret_id }` on Psono,
   - decrypts Psono's answer locally (NaCl secretbox, two steps) and
   - returns **metadata only** through an allow-list (`secret-mapper.ts`).
4. *Show* on the password → `POST /secrets/reveal`; *Show* on the OTP →
   `POST /secrets/otp` (the sidecar computes the TOTP; the seed never leaves it).

Every API request is checked for same-origin, Wiki.js identity, per-user rate
limit and a strict JSON schema. Errors map to one of a small set of statuses
(`not_configured`, `forbidden`, `invalid_credentials`, `server_changed`,
`unavailable`, …); nothing from Wiki.js or Psono error bodies is relayed.

## Data model (sidecar database)

`psono_connector_device_credentials`: one row per enrolled browser —
`device_id`, `wiki_user_id`, the two encrypted values (AES-256-GCM, AAD binds
user/device/field/key version), `key_version`, `expires_at` (≤ 30 days). The
device secret exists **only** in the browser's `HttpOnly` cookie.
`psono_connector_schema_migrations` tracks versions; migrations run at start under
an advisory lock, and the sidecar refuses a schema newer than itself.

## Source map

```text
src/shared/psono-reference.ts   URL matcher + canonical link builder
src/renderer/index.ts           Wiki.js rendering module (cheerio)
src/client/                     browser bundle: card.ts, credentials-form.ts, api.ts, i18n.ts, …
src/sidecar/
  main.ts, cli.ts, doctor.ts    entry point and commands (print-server-pin, install-module, doctor)
  config.ts                     environment parsing and validation
  server.ts                     HTTP API, guards, headers
  secret-service.ts             the request pipeline above
  crypto/credential-cipher.ts   device-bound encryption
  db/credential-store.ts        PostgreSQL / in-memory store, migrations
  device-cookie.ts              the HttpOnly cookie
  psono/                        client, server-identity (pinning), secret-mapper, totp
  wikijs/identity.ts            who is this user? (GraphQL)
wikijs-module/                  definition.yml of the Wiki.js module
scripts/                        build, compatibility check, secrets init, repo checks
deploy/                         compose, env and proxy examples
```
