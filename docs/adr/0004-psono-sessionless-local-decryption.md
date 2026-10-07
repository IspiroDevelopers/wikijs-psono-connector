# ADR-0004: Psono access via session-less API key with local decryption

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07). The *storage* part (one row per user) is superseded by [ADR-0008](0008-device-bound-keys.md).

## Decision

- Use `POST /api-key-access/secret/` with `{ api_key_id, secret_id }` only and
  decrypt locally in the sidecar (two NaCl SecretBox steps).
- Store per user only `api_key_id` and `api_key_secret_key`, encrypted with
  AES-256-GCM (random 96-bit nonce per record, key version, AAD = Wiki.js user
  id + field name). Master key from `PSONO_CONNECTOR_MASTER_KEY` /
  `_FILE` (Docker secret). Never the API key `private_key`.
- Never send `api_key_secret_key` to Psono (that would be remote decryption).
- Recommend users create keys with `read`, no `write`,
  `allow_insecure_access = false`, `restrict_to_secrets = true`.
- Map `400 NO_PERMISSION_OR_NOT_EXIST` to one UI state
  ("not available with your Psono API key").
- OTP codes are computed in the sidecar; the TOTP seed never reaches the browser.

## Consequences

- Users must add each referenced secret to their API key. The UI states this
  clearly and links to the user documentation.
- Each resolve/OTP refresh increments `read_count` in Psono. OTP refresh only
  runs while the component is visible and the tab is active.
- Threat model: compromise of the sidecar **and** the master key exposes every
  secret linked to stored API keys. Mitigations: separate container, no shell
  tools in image, master key as a Docker secret, read-only root FS, egress
  restricted to the Psono API host.
