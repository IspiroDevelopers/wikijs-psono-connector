# ADR-0006: How users enter their Psono API key

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Refines: spec v1 §6 (see [docs/history](../history/spec-v1-it.md))
- Storage model superseded by [ADR-0008](0008-device-bound-keys.md): keys are now stored per browser and expire after 30 days.

## Context

Wiki.js 2.x cannot be extended with new profile pages or fields without
rebuilding its frontend (ADR-0001). The sidecar shares the Wiki.js origin
through the reverse proxy, so the browser sends the Wiki.js `jwt` cookie to
`/psono-connector/*` as well (ADR-0003).

## Decision

Two entry points, both served by the connector, both authenticated by the
existing Wiki.js session (no second login):

1. **In-page dialog (primary).** When a credential card is rendered for a user
   with no stored key, it shows "Configure your Psono API key" with a
   *Configure* button. The bundle opens a dialog in the page; on save the card
   loads immediately, without navigation.
2. **Settings page** at `/psono-connector/settings`, a small standalone page
   served by the sidecar (status, replace, delete). Admins can link it from
   **Admin → Navigation** (a standard Wiki.js feature); the docs include the
   exact steps.

The dialog/page asks for exactly two values: **API key ID** (UUID) and
**API key secret key** (64 hex chars). It shows the recommended Psono key
settings (read on, write off, insecure access off, restricted to secrets) and
reminds the user to add every referenced secret to the key.

API:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/psono-connector/api/me/status` | `{ pluginEnabled, credentialsConfigured }` |
| `PUT` | `/psono-connector/api/me/credentials` | body `{ apiKeyId, apiKeySecretKey }`; response never echoes values |
| `DELETE` | `/psono-connector/api/me/credentials` | |
| `POST` | `/psono-connector/api/me/credentials/test` | body `{ url }` — optional test against one Psono link |

All mutating routes follow the CSRF rules in ADR-0003.

## Write-only keys, always manageable

- **Write-only.** There is no route that returns a stored key, in any form,
  to anyone — the user included. The only observable state is
  `credentialsConfigured: true|false`. To change a key the user enters a new
  one; the old one is overwritten. Tests assert that no API response ever
  contains the stored key id or secret key. Input fields are cleared right
  after saving and carry hints asking password managers not to capture them.
- **Always manageable.** Every credential card — success, Psono denial,
  invalid key, Psono unavailable — has an *API key* button that opens the
  dialog to replace or remove the key. Removing needs a confirming second
  click. Replacing or removing reloads every card on the page. Deleting works
  without contacting Psono, so a revoked or broken key can always be removed.
  The settings page offers the same actions.

## Validation limits

Psono has no endpoint to validate an API key on its own: the session-less
endpoint always needs a `secret_id`, and returns the same
`NO_PERMISSION_OR_NOT_EXIST` for an unknown key and an unlinked secret. So:

- On save, only the format is validated (UUID, 64 hex).
- The optional test takes a Psono link and performs one real resolve, returning
  only success/failure (no secret fields).
- A wrong or revoked key surfaces on first use as "API key invalid or no access",
  with a *Reconfigure* button. Decryption failure of `secret_key` (wrong
  `api_key_secret_key`) is reported distinctly as "API key secret key invalid".

## Consequences

- No Wiki.js UI change; the settings live where the connector lives.
- The stored key is never returned to any client; the UI shows only
  "configured / not configured".
