# ADR-0008: API keys are bound to the browser and expire after 30 days

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Supersedes: the per-user storage of ADR-0004 / ADR-0006 (one key per user)

## Context

The Wiki.js 2.x session cookie (`jwt`) is readable by JavaScript (not
`HttpOnly`), long-lived, and `Secure` only when the site URL is `https://`
(verified in `server/helpers/common.js`, `getCookieOpts`). Anyone who steals it
— through XSS, a page script written by a user with `write:scripts`, or a
compromised browser — could call the connector from their own machine
(origin checks only bind browsers) and read the victim's secrets with the
victim's stored API key.

Separately, with per-user storage, whoever obtains the sidecar database **and**
its master key can decrypt every stored API key.

## Decision

1. **Per-browser enrollment.** Saving a key creates a *device*: a random UUID
   and a random 256-bit **device secret**. The sidecar returns the pair in a
   cookie and does **not** store the secret.
2. **Two-part key.** The row is encrypted with AES-256-GCM under
   `HKDF-SHA256(master key, salt = device secret, info = device id + key version)`;
   the AAD binds user, device, field and key version. Decryption needs both the
   server's master key and the browser's cookie.
3. **The cookie** is `HttpOnly; SameSite=Strict; Path=/psono-connector/`, plus
   `Secure` when `PSONO_CONNECTOR_PUBLIC_URL` is `https://`. Scripts cannot read
   it; it is sent only to the connector, only same-site.
4. **Fixed expiry.** An enrollment expires `PSONO_CONNECTOR_DEVICE_TTL_DAYS`
   (default and maximum **30**) after it was created. It is not extended by use.
   After that the user enters the key again. Expired rows are purged hourly.
5. **Removal.** *Remove from this browser* deletes the current enrollment;
   *Remove from all my browsers* deletes every enrollment of the user (lost
   device). Neither contacts Psono.
6. **Limits.** At most 20 enrolled browsers per user; enrolling a 21st drops the
   one expiring first. Replacing the key on a browser removes that browser's
   previous row.
7. **Failure behaviour.** A missing, expired, foreign (other user) or forged
   (wrong secret) cookie is indistinguishable from "no key": the API answers
   `not_configured` and clears the cookie.

## Consequences

- A stolen Wiki.js JWT alone reads nothing. An attacker needs code running *in
  the victim's browser on the wiki origin* (which can use, but not extract, the
  HttpOnly cookie) — the inherent same-origin risk (threat model R1).
- A database dump plus the master key no longer decrypts stored keys: the
  device secrets exist only in users' browsers. An attacker with live code
  execution in the sidecar can still capture keys **as they are used**.
- Users enter their key once per browser/device and again every 30 days.
- Migration v2 drops the v1 per-user table: existing users re-enter their key
  once.

## Rejected alternative: logging in to Psono from the card

Considered: let users sign in to Psono from the wiki (like the browser
extension) and keep that session for ~30 days instead of using an API key.
Rejected because it would:

- give the connector a full session — the **entire vault, read and write** —
  instead of a read-only key limited to the secrets linked in the wiki;
- teach users to type their **Psono master password into a wiki page**, the
  exact pattern phishing relies on, where any script on the page could capture
  it;
- require reimplementing Psono's login protocol and every second factor;
  WebAuthn/passkeys are bound to Psono's origin and cannot work from the wiki;
  SAML/OIDC would need redirect flows;
- tie the connector to the internal protocol of the Psono client, which is not
  a public API.

API keys are Psono's supported mechanism for limited programmatic access;
device binding plus a 30-day expiry gives a comparable "enter once, works for
a month" experience without those costs.
