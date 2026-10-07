# Compatibility and tested versions

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

"Tested" below means exactly what is written in the *How* column. Anything not
listed is **untested**: it may work, or it may not, and we make no claim either way.
All checks were run on **2026-10-07** on one host (Ubuntu 24.04.4 LTS, kernel 6.8,
Docker Engine 29.3.0, Docker Compose 5.1.0). The machine-readable summary is in
[`connector.manifest.json`](../connector.manifest.json).

## Wiki.js

| Version | Node.js in the image | How it was checked |
|---|---|---|
| **2.5.316** | 24.21.0 | **End to end in a browser**: module loaded, links marked, credential cards (including the one-time code) rendered, API key dialog; other flows (password reveal, key removal, expiry, server pinning, …) are covered by the automated tests below, not by manual runs |
| 2.5.300 | 18.17.0 | `scripts/compat-wikijs.sh`: the built module loads from the real module path and its output survives the image's own `html-security` sanitizer |
| 2.5.170 | 14.14.0 | same automated check |

- **Wiki.js 3.x:** out of scope (different architecture); not tested.
- The module depends on Wiki.js internals that are stable across 2.x but not
  formally documented: the module folder layout (`modules/rendering/<kebab-case
  key>/`), `definition.yml`, the `init($, config)` renderer signature (cheerio),
  the `html-security` post step, and the public GraphQL `users.profile` query. A
  Wiki.js update could change them; the CI compatibility job exists to notice.

## Psono

| Component | Version tested | How |
|---|---|---|
| Server | **7.4.5** (build 930c112b), Community Edition | live tests (8) and end to end |
| Web client | 4.8.2 (build 2f7a62a) | link formats and API-key behaviour read from this source; used end to end |
| Image | `psono/psono-combo` | server and client in one container |

- **Enterprise Edition and other versions:** untested. The connector relies on the
  session-less API-key endpoint `POST /api-key-access/secret/` and on the signed
  `GET /info/` document (server pinning). Behavioural note observed on 7.4.5: a
  denied or unknown entry answers HTTP 400 with the bare text `non_field_errors`
  (the source builds answer with a JSON body); both forms are handled.

## Runtime and infrastructure

| Component | Version tested | Notes |
|---|---|---|
| Sidecar (Node.js) | 24.21.0, `node:24-alpine` pinned by digest | `engines.node` says ≥ 20; only 24 is tested |
| PostgreSQL (connector database) | 17.8 | other versions and engines untested |
| PostgreSQL (Wiki.js database) | 17.8 | not touched by the connector |
| Reverse proxy | **Caddy 2.11.7** | the only proxy exercised |
| Docker / Compose | Engine 29.3.0 / Compose 5.1.0 | |

## Reverse proxies

| Proxy | Status |
|---|---|
| Caddy | exercised in the project's development setup |
| nginx (same host / separate host) | **unverified** — standard directives, documented; run the *Verify* checks in [reverse-proxy.md](deployment/reverse-proxy.md) |
| Traefik, Apache httpd | **unverified** |

## Browsers

The browser bundle targets ES2020 (Chrome 100, Firefox 100, Safari 15 as build
targets) and uses `<dialog>`, shadow DOM, `IntersectionObserver` and the Clipboard
API. It was exercised **manually in one desktop browser (dark theme)**; the
automated tests run it in jsdom. There has been **no systematic cross-browser or
mobile testing**.

## Automated test suite (as of this version)

256 tests: unit (URL matcher incl. bypass attempts, TOTP against RFC 6238 vectors,
cipher/store, Psono client, server pinning, config, doctor), integration (renderer
and sanitizer pipeline, the sidecar HTTP API with real crypto, the browser bundle
in jsdom) and 8 live tests against a real throwaway Psono 7.4.5. CI additionally
type-checks, audits runtime dependencies, runs CodeQL, builds the image and
checks the module against the Wiki.js versions above.

## Reporting results

Tried another combination? Please open an issue with the versions and what you
checked (the `doctor` output is safe to paste), and we will extend this page.
