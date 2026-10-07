# Wiki.js Psono Connector

> [!CAUTION]
> **HTTPS IS REQUIRED.** Run Wiki.js, the connector and Psono **only over HTTPS**
> (Wiki.js *Administration → General → Site URL* must start with `https://`).
> Over plain HTTP, users' Psono API keys, passwords, one-time codes and the
> Wiki.js session cookie travel **in clear text** and can be intercepted by
> anyone on the network path. The sidecar refuses `http://` URLs unless
> `PSONO_CONNECTOR_ALLOW_HTTP=true`, which exists **for local development only**;
> the browser UI shows a red warning whenever a page is not served over HTTPS.

> [!WARNING]
> **Pre-release, provided as is, no warranty, not independently audited.** You are
> responsible for evaluating, deploying and securing it. Read the
> [disclaimer](#disclaimer--read-this-before-you-use-it) first.

Show [Psono](https://psono.com) credentials inside [Wiki.js](https://js.wiki)
pages. Paste a link to a Psono entry into a page and readers see a card with the
title, URL, username, notes, password and one-time code — each reader through
**their own read-only Psono API key**, so Psono keeps deciding who may see what.

![A credential card in a Wiki.js page: title, URL, username, hidden password and a one-time code with a countdown (demo data, dark theme)](docs/images/credential-card.png)

*A card in a wiki page (demo data). The password and the one-time code stay hidden
until the reader clicks Show; the code refreshes itself while it is visible.*

## How it works

```text
Browser ──► your reverse proxy ──┬──► Wiki.js 2.x  (unmodified)
                                 │      └─ module: marks links to your Psono as <a class="psono-connector-link">
                                 └──► /psono-connector/…  the sidecar (this project)
                                        ├─ asks Wiki.js (GraphQL) who the user is
                                        ├─ keeps each browser's encrypted Psono API key
                                        └─ asks Psono, decrypts locally, returns only the allowed fields
```

- **Wiki.js stays untouched and upgradable.** No patches, no fork: a read-only
  module mount, one script tag in the theme, and a small separate service.
- **Psono stays the authority.** Each user's own read-only API key is used; the
  connector cannot show anything that key cannot already read in Psono.

Details: [architecture](docs/architecture.md) · [decisions (ADRs)](docs/adr/README.md).

## What it looks like

**1 · The administrator enables the module** in Wiki.js (*Administration → Rendering*)
and sets the address of the Psono web client:

![The Psono Connector panel in the Wiki.js rendering settings: enabled, with the Psono web client URL field](docs/images/admin-rendering.png)

**2 · A reader meets a Psono link for the first time** and is offered to configure
their own read-only Psono API key:

![A card for a Psono link that says "Configure your Psono API key to view this credential" with Configure Psono and Open in Psono buttons](docs/images/card-not-configured.png)

**3 · One dialog, two values.** Paste the API key ID and its secret key; the key is
bound to this browser, can be removed at any time and can never be displayed again.
From then on every card in the wiki works, and shows what Psono allows that user to see
(first image above):

![The Psono API key dialog with instructions and two fields: API key ID and API key secret key](docs/images/api-key-dialog.png)

*Screenshots come from a development setup (plain HTTP, hence addresses replaced by
examples) and a slightly earlier build; wording and layout may differ a little.
In production everything runs over HTTPS.*

## Security design in brief — and why

| What we do | Why |
|---|---|
| **Pages contain only the link.** Secrets are fetched when a reader views the page, never stored in page HTML, the Wiki.js database, search index, history, exports or backups. | Wiki content is copied everywhere (search, revisions, backups, exports); a secret there would be copied with it. |
| **A separate sidecar service instead of patching Wiki.js.** | Wiki.js 2.x has no extension API for backend routes. Patching its files breaks on every upgrade, and running inside Wiki.js would put the keys in the same process as every page script and plugin. |
| **Psono API keys, not a Psono login.** Read-only, limited to the entries added to the key, "insecure access" off. | Least privilege. A login would give the connector the whole vault (read **and** write), teach users to type their master password into a wiki page, and cannot work with passkeys/WebAuthn. |
| **Keys are bound to one browser and expire after at most 30 days.** The stored key is decryptable only with a secret kept in an `HttpOnly` cookie in that browser. | The Wiki.js 2.x session cookie can be read by scripts; if it is stolen, or the database leaks, that alone must not unlock anyone's key. |
| **Saved keys can never be read back** — not even by their owner. | Nothing to leak through the UI, the API or a screenshot. Replacing or removing a key is always possible. |
| **The Psono server is pinned** (its Ed25519 signing key). If it stops proving its identity the connector sends nothing and every card warns. | A replaced, hijacked or impersonated server must not receive requests or be trusted. |
| **Hidden until asked, minimal data.** Passwords and one-time codes are fetched only on *Show*/*Copy*, wiped after 30 s; only an allow-list of fields leaves the sidecar; TOTP seeds never reach the browser; logs never contain secrets. | Reduce what is exposed, to whom, and for how long. |
| **Strict link and request validation.** Exact scheme/host/port/path matching, same-origin (CSRF) guard, rate limits, no redirects followed, only the admin-configured Psono is ever contacted. | Block look-alike-domain phishing, SSRF and cross-site abuse. |

**What it cannot protect against** (details and mitigations in the
[threat model](docs/threat-model.md)): scripts running on your wiki's origin written
by users who may attach JavaScript to pages (restrict `write:scripts` to
administrators); a compromised sidecar host (it can capture keys as they are used);
a compromised user browser or clipboard; and running without HTTPS.

## Disclaimer — read this before you use it

This is free software published by volunteers and provided **"as is", without
warranty of any kind** (see sections 15–16 of the [AGPL-3.0 license](LICENSE)).
This section is a plain-language summary, not legal advice; the license text governs.

- We designed it carefully and have explained our choices above, but **we cannot
  guarantee that it is free of bugs or vulnerabilities, and it has not been
  independently audited.** Handling credentials always carries risk.
- **The authors and contributors accept no responsibility or liability** for any
  damage or loss arising from using, deploying, misconfiguring, or being unable to
  use this software — including data loss, leaked or compromised credentials or
  accounts, security incidents and attacks, downtime, or legal and compliance
  consequences. If something breaks, is lost or is attacked, that is not our
  fault. There is no support or maintenance obligation.
- **You are responsible for** deciding whether it suits your environment and the
  data you put behind it; deploying it as documented (HTTPS, restricted Wiki.js
  permissions, firewalling, updates); protecting and backing up your secrets
  (notably the master key); testing before relying on it; and monitoring it.
- Keep Psono as your system of record and keep **independent backups** of Psono
  and Wiki.js. The connector only reads from Psono and never writes to it, but a
  bug could still expose, or fail to show, a credential.
- Wiki.js, Psono, Docker, PostgreSQL and other third-party software are governed by
  their own licenses and are not covered by us. This project is not affiliated
  with them (see below).

## Tested with

Everything below was verified on **2026-10-07** on one Ubuntu 24.04 host.
Anything not listed is **untested** — it may work, or not. Full detail:
[docs/compatibility.md](docs/compatibility.md).

| Component | Version tested | Notes |
|---|---|---|
| **Wiki.js** | **2.5.316** (end to end in a browser) · 2.5.300 and 2.5.170 (module + sanitizer check only) | Wiki.js 3 is out of scope |
| **Psono** CE | server **7.4.5** (build 930c112b) · web client 4.8.2 · `psono/psono-combo` image | Enterprise Edition untested |
| Sidecar runtime | Node.js 24.21.0 (`node:24-alpine`) | image pinned by digest |
| Database (connector and Wiki.js) | PostgreSQL 17.8 | other versions/engines untested |
| Reverse proxy | Caddy 2.11.7 | **nginx, Traefik, Apache: snippets provided but unverified** |
| Container engine | Docker Engine 29.3.0, Compose 5.1.0 | |
| Browser | manually in one desktop browser (dark theme); automated tests use jsdom | no systematic cross-browser testing |

## Quick start

You need: Wiki.js 2.x, a Psono server, HTTPS, and a reverse proxy in front of
Wiki.js that can route one extra path (nginx, Caddy, Traefik, Apache…).

```sh
# 1. Get the deployment files and create secrets + config
git clone https://github.com/IspiroDevelopers/wikijs-psono-connector && cd wikijs-psono-connector/deploy
sh ../scripts/init-secrets.sh .

# 2. Set your URLs and the Psono server pin in connector.env, then start
$EDITOR connector.env
docker compose up -d

# 3. Install the Wiki.js module (read-only mount) and add one proxy rule
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$PWD/modules:/out" psono-connector node main.cjs install-module /out

# 4. Check everything
docker compose exec psono-connector node main.cjs doctor
```

Then enable the module and add the script tag in the Wiki.js administration
area. The complete, step-by-step guide — including the reverse proxy rule for
nginx on another machine — is in **[docs/installation.md](docs/installation.md)**.

## Documentation

| For | Read |
|---|---|
| Installing | [Installation](docs/installation.md) · [Reverse proxy](docs/deployment/reverse-proxy.md) · [Configuration](docs/configuration.md) |
| Going to production | [Production checklist](docs/deployment/production-checklist.md) · [Threat model](docs/threat-model.md) |
| Users of the wiki | [User guide](docs/user-guide.md) |
| When something is wrong | [Troubleshooting](docs/troubleshooting.md) |
| Understanding / contributing | [Architecture](docs/architecture.md) · [Development](docs/development.md) · [CONTRIBUTING](CONTRIBUTING.md) |
| Versions | [Compatibility](docs/compatibility.md) · [Changelog](CHANGELOG.md) |

## Security

Report vulnerabilities **privately** — see [SECURITY.md](SECURITY.md). Never put
real keys, passwords or cookies in issues.

## License

Copyright © 2026 the Wiki.js Psono Connector contributors.
Licensed under the **[GNU Affero General Public License v3.0 only](LICENSE)**.

The connector is designed to be loaded into Wiki.js, which is AGPL-3.0 as well.
If you modify the connector and let others use it over a network you must offer
them your version's source: the sidecar's settings page links to
`/psono-connector/source`, which you can point at your fork with
`PSONO_CONNECTOR_SOURCE_URL`. The container image ships the licenses of all
bundled third-party software in `THIRD_PARTY_NOTICES.txt`. No code of Wiki.js or
Psono is copied into this project; Psono's Apache-2.0 sources were studied to
implement its documented API-key protocol.

Wiki.js Psono Connector is an independent community project.
It is not affiliated with, sponsored by, or endorsed by Wiki.js,
Requarks.io, Psono, or esaqa GmbH.
