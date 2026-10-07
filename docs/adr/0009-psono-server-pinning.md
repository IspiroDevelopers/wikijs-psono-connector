# ADR-0009: The Psono server's identity is pinned

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)

## Context

The administrator configures where the connector sends Psono requests
(`PSONO_API_BASE_URL`). If that destination is replaced, hijacked (DNS, a
compromised host, a restored-from-backup server that is not the real one) or
impersonated, the connector would keep sending requests to it.

What the connector sends to Psono (`POST /api-key-access/secret/`): only the
**API key id** and a **secret id**. The **API key secret key never leaves the
sidecar** (local decryption, ADR-0004), and every Psono answer is authenticated
with it (NaCl secretbox), so a fake server **cannot forge credentials** either:
decryption simply fails. The exposure is therefore the API key id and the ids of
the secrets users look at, plus a denial of service.

Even so, a server that is not the real one must not be talked to.

## Decision

Psono signs its public `/info/` document with Ed25519: the response is
`{ info, signature, verify_key }`, where `verify_key` is shown as the
**"server signature"** in the Psono API key dialog.

1. The administrator pins that key: `PSONO_SERVER_VERIFY_KEY` (64 hex chars).
   It is **required**; the sidecar refuses to start without it. The command
   `node main.cjs print-server-pin` prints the current value (trust on first
   use: compare it with the Psono web client or administrator).
2. Before the sidecar sends anything to Psono it verifies that the server's
   `/info/` carries a **valid signature** by **exactly the pinned key**.
   A different key, an invalid signature, a non-Psono answer (HTML, 404) or
   tampered content counts as **changed**. 5xx/429/network errors count as
   **unavailable** (not an identity problem).
3. Results are cached (5 minutes if good, 30 s if changed, 5 s if unavailable);
   concurrent checks share one request. State transitions are logged once
   (`psono.server_changed` at error level, with the first 16 hex chars of the
   key seen).
4. When the identity is **changed**:
   - no request that carries an API key id or secret id is sent to the server;
   - every card shows a security warning (`server_changed`) that takes
     precedence over "configure your key", so users are not invited to enter
     one;
   - **saving** a key is refused (HTTP 409); **removing** keys keeps working;
   - `/me/status` reports `psonoServer: "changed"`.

## Where the pin lives

In the sidecar's configuration (environment/secret), **not** in the Wiki.js
administration panel:

- the Wiki.js renderer settings live in the Wiki.js database and are only
  readable through admin-level GraphQL; the sidecar would need an administrator
  token (or direct database access), breaking the isolation of ADR-0001;
- the pin protects against a compromised Psono, so it should sit with the other
  security-critical settings (master key, URLs) that only the host operator can
  change.

## Consequences

- A rotated Psono server key requires updating the pin (documented in
  [configuration.md](../configuration.md)). Until then the connector refuses to
  talk to the server — failing closed is the point.
- Not a defence against a **relay** (a machine in the middle forwarding `/info/`
  to the real server); that is TLS's job. A relay still cannot read or forge
  secrets (see Context).
