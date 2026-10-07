# Threat model

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Scope: the rendering module, the browser bundle and the sidecar, deployed as in
[installation.md](installation.md). Facts about Wiki.js refer to 2.5.316.

## Assets

| Asset | Where it lives |
|---|---|
| Psono secrets (password, TOTP seed, username, notes) | Psono. Decrypted transiently in sidecar memory; selected fields sent to the user's browser on request. TOTP seeds never leave the sidecar. |
| Users' Psono API key material (`api_key_id`, `api_key_secret_key`) | Sidecar DB, one row per enrolled browser, AES-256-GCM under a key derived from the master key **and** a device secret that exists only in that browser's HttpOnly cookie. Expires after at most 30 days. |
| Device secrets | Users' browsers only (HttpOnly cookie). Never stored server-side. |
| Master key | Sidecar container (Docker secret / env). Never in the DB. |
| Wiki.js session (JWT in the `jwt` cookie) | Browser. |

## Trust boundaries and assumptions

1. **The wiki origin is trusted.** Any JavaScript running on the wiki's origin
   can call the connector API *as the signed-in user*, exactly like the bundle
   does. This is inherent to any same-origin integration.
2. **Psono is the authority** on who may read which secret. The connector never
   widens access: it can only read what the user's own API key can read.
3. **Wiki.js is the authority** on who the user is (GraphQL `users.profile`).
4. The reverse proxy terminates TLS; the network between proxy, Wiki.js,
   sidecar and Psono is not hostile (or is protected by the operator).

## What the design protects against

| Threat | Mitigation |
|---|---|
| Secrets stored in page HTML, history, search index, backups, exports | Renderer only marks links; secrets are fetched at view time (ADR-0002). |
| Shoulder surfing / secrets sent but never looked at | Passwords and one-time codes are hidden by default and fetched only on *Show* or *Copy*; the initial card load carries metadata only. |
| A user reading secrets they have no Psono access to | Each request uses only the caller's own key; Psono decides. Tests cover cross-user isolation. |
| Editor plants a link to someone else's secret | The viewer's own key is used; the editor learns nothing. Worst case the viewer's Psono read counter/audit records a read (use `PSONO_CONNECTOR_LOAD_MODE=click` to require a click). |
| Psono server replaced, hijacked or impersonated | The sidecar verifies Psono's Ed25519-signed `/info/` against a pinned key before sending anything; on mismatch it stops, cards warn, new keys are refused (ADR-0009). A fake server also cannot forge secrets: answers are authenticated with the API key secret key, which is never sent. |
| SSRF via crafted links | The sidecar only ever calls `PSONO_API_BASE_URL` and `WIKIJS_INTERNAL_URL`; links are re-validated with an exact scheme/host/port/path match; redirects are not followed; response size and time are capped. |
| CSRF from other sites | Custom header + `Origin`/`Sec-Fetch-Site` same-origin check; JSON-only bodies; Wiki.js cookie has no `SameSite` but browsers default to `Lax`. |
| XSS through Psono data (titles, notes, URLs) | Rendered with `textContent` only, inside a closed shadow root; only `http(s)` URLs become links. |
| DB dump of the sidecar (even with the master key) | Ciphertext only; each row also needs its browser's device secret. Rows cannot be moved between users, devices or fields (AAD). |
| Stolen Wiki.js session token | Useless without the browser's HttpOnly device cookie (ADR-0008). |
| Forgotten/lost device | Enrollments expire after ≤30 days; *Remove from all my browsers* revokes them at once. |
| Server-side decryption by Psono | Never requested; users are told to disable *allow insecure access* on their keys. |
| Reading back a stored API key | No such route exists; responses are tested not to contain key material (ADR-0006). |
| Secrets in logs | No request/body/header logging; only event names, Wiki.js user id and a hashed secret reference. Tested. |
| Caching by proxies/browsers | `Cache-Control: no-store, private` on every response. |
| Brute force / amplification | Per-user rate limits (configurable, see configuration.md); per-IP cap on failed authentications; volumetric limits are the reverse proxy's job (reverse-proxy.md) (each costs a Wiki.js GraphQL call). |
| Clickjacking of connector pages | `X-Frame-Options: DENY`, `frame-ancestors 'none'`. |

## Residual risks (read before deploying)

### R1 — Script on the wiki origin = access to viewers' secrets (high impact)

Wiki.js lets users with the **`write:scripts`** permission attach arbitrary
JavaScript to a page (Page properties → Scripts), and admins can inject code
site-wide. If html sanitisation is turned off (Rendering → Security →
*Sanitize HTML*), every editor can inject script through page content.

Such a script runs as the viewing user and can call the connector API to
reveal that user's passwords and OTP codes.

**Required configuration:**

- Keep *Rendering → HTML → Security → Sanitize HTML* **on** and *Allow
  iframes* **off**.
- Grant `write:scripts` (and `write:styles`) **only to administrators**.
- Treat Wiki.js admin accounts as able to read the secrets of everyone who
  uses the connector.

### R2 — Stolen Wiki.js JWT (mitigated)

In Wiki.js 2.x the `jwt` cookie is **readable by JavaScript** (not
`HttpOnly`), long-lived, and only `Secure` when the site host is `https://`.

**Mitigation (ADR-0008):** stored API keys are bound to the browser. They can
only be decrypted with a device secret held in an `HttpOnly`, `SameSite=Strict`
cookie scoped to `/psono-connector/`, which scripts cannot read. A stolen JWT
used from another machine gets `not_configured` and never reaches Psono.

**Residual:** code running in the victim's browser on the wiki origin (R1) can
still *use* the cookie while the victim has the page open. Keep R1's
configuration and serve the wiki over `https://`.

### R3 — Sidecar compromise (high impact)

A database dump, even together with the master key, does not decrypt stored
API keys: each also needs its browser's device secret (ADR-0008). An attacker
with **live code execution** in the sidecar, however, sees device cookies as
requests arrive and can capture the keys of every user who uses the connector
during that time, then read every secret linked to those keys.
Mitigations: separate container, non-root, read-only filesystem, all
capabilities dropped, no npm in the image, minimal dependencies (3 direct),
egress limited by the operator to Psono and Wiki.js. Users should link **only
the secrets they need in the wiki** to their API key.

### R4 — Session validity window

The sidecar caches "token → user" for 15 s. A user who logs out or is
deactivated may keep access for up to 15 s.

### R5 — Clipboard and screen

Copied passwords stay in the OS clipboard; the connector cannot clear it
reliably. Revealed passwords and one-time codes are wiped from the page after
`PSONO_CONNECTOR_PASSWORD_VISIBLE_SECONDS`, but may have been seen or
screenshotted.

### R6 — Password managers

Key input fields ask password managers not to capture them, but managers may
ignore these hints, making the key retrievable from the manager.

### R8 — Pin set without verification

`print-server-pin` trusts the server on first use. If an administrator pins a
key printed by an already-compromised or impersonated server, the pin protects
nothing. Compare the value with Psono's own UI or administrator. A relay in the
middle that forwards `/info/` still passes the check, but can neither read nor
forge secrets (only the API key id and secret ids are visible to it); use TLS.

### R7 — Upstream Wiki.js

Wiki.js 2.5.316 ships DOMPurify 3.3.1, for which advisories exist (mostly in
modes Wiki.js does not use). Sanitizer bypasses translate into R1. Keep
Wiki.js updated.
