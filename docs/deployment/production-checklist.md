# Production checklist

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> [!CAUTION]
> **HTTPS IS REQUIRED.** Run Wiki.js, the connector and Psono **only over HTTPS**
> (Wiki.js *Administration → General → Site URL* must start with `https://`).
> Over plain HTTP, users' Psono API keys, passwords, one-time codes and the
> Wiki.js session cookie travel **in clear text** and can be intercepted by
> anyone on the network path. The sidecar refuses `http://` URLs unless
> `PSONO_CONNECTOR_ALLOW_HTTP=true`, which exists **for local development only**;
> the browser UI shows a red warning whenever a page is not served over HTTPS.

Go through this list before enabling the connector for real users. Each item
refers to a risk in [threat-model.md](../threat-model.md).

## Wiki.js

- [ ] **Site URL** (Administration → General → Site URL) uses `https://`.
      Wiki.js only marks its `jwt` cookie `Secure` when it does. (R2)
- [ ] **Sanitize HTML** is on and **Allow iframes** is off
      (Administration → Rendering → HTML → Security). (R1)
- [ ] The **`write:scripts`** and **`write:styles`** permissions are granted to
      administrators only (Administration → Groups → Permissions). (R1)
- [ ] Administrators are few, use strong authentication, and are trusted with
      the fact that they could read the secrets of connector users. (R1)
- [ ] Wiki.js is on the latest 2.5.x. (R7)
- [ ] Wiki.js itself is **not** reachable bypassing the proxy (bind its port
      to loopback/LAN and firewall it), so every user goes through the URL where
      `/psono-connector/` is routed.

## Reverse proxy

- [ ] `/psono-connector/` routed unchanged to the sidecar; **Verify** checks
      from [reverse-proxy.md](reverse-proxy.md) pass.
- [ ] No caching rule applies to `/psono-connector/`.
- [ ] The wiki site sends `Strict-Transport-Security` (HSTS) so browsers never
      fall back to HTTP (Caddy example: `header Strict-Transport-Security "max-age=31536000"`;
      nginx: `add_header Strict-Transport-Security "max-age=31536000" always;`).
- [ ] The sidecar port is reachable **only** from the proxy (bound to a
      specific IP and firewalled; tested from a third machine).
- [ ] `PSONO_CONNECTOR_TRUSTED_PROXIES` is set to the proxy's IP, so per-IP
      limits and logs see real client addresses.
- [ ] Optional: `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'self'` on the
      wiki pages themselves.

## Sidecar

- [ ] `PSONO_CONNECTOR_PUBLIC_URL`, `PSONO_WEB_BASE_URL`, `PSONO_API_BASE_URL`
      use `https://`; `PSONO_CONNECTOR_ALLOW_HTTP` is **unset/false**.
- [ ] `PSONO_SERVER_VERIFY_KEY` is set to the value you **verified** against Psono
      (the "server signature" in its API key dialog), not blindly copied from
      `print-server-pin`. (R8)
- [ ] Image pinned to a released version (not `latest`, not a local `:dev`).
- [ ] Container runs with `read_only: true`, `cap_drop: [ALL]`,
      `no-new-privileges` (as in the installation example).
- [ ] Master key generated with `openssl rand -hex 32`, stored as a Docker
      secret file with mode `600`, **backed up offline**. Losing it only forces
      users to re-enter keys; leaking it exposes stored keys if the DB leaks too.
- [ ] Egress from the sidecar limited to the Psono API host and Wiki.js, if your
      network allows it. (R3)
- [ ] Logs collected; they contain Wiki.js user ids and hashed secret refs, no
      secrets.

## Database

- [ ] Dedicated database and role for the connector (not the Wiki.js role).
- [ ] `sslmode=require` (or stronger) in `DATABASE_URL` if PostgreSQL is on
      another host.
- [ ] Backups included in your normal backup policy (contents are encrypted).

## Psono and users

- [ ] Users are told how to create their key: **Read** on, **Write** off,
      **Allow insecure access** off, **Restrict to secrets** on.
- [ ] Users link to their API key **only** the entries they need in the wiki.
      (R3)
- [ ] Nobody pastes Psono **link-share** URLs into the wiki: they contain the
      decryption key in the URL itself and are never turned into cards.

## Rollout and rollback

- [ ] `docker compose exec psono-connector node main.cjs doctor` reports no problems.
- [ ] If you run a **modified** version, `PSONO_CONNECTOR_SOURCE_URL` points at
      your source (AGPL-3.0 §13).
- [ ] Try first with a test page and one or two users.
- [ ] Rollback is immediate: set `PSONO_CONNECTOR_ENABLED=false` and restart
      the sidecar (links become plain links), or remove the script tag from
      Theme → Code Injection.
