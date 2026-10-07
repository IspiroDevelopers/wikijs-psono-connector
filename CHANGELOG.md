# Changelog

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may contain
breaking changes, which are always listed).

## [Unreleased]

## [0.1.0] — first public pre-release

### Added
- Wiki.js 2.x rendering module that marks links to the configured Psono server
  (exact scheme/host/port/path match; link shares are never transformed).
- Sidecar service: Wiki.js identity via GraphQL, per-browser encrypted Psono API
  keys, Psono session-less access with local decryption, field allow-list,
  TOTP computed server-side, rate limits, same-origin (CSRF) guard, audit log
  without secrets.
- Browser bundle: lazy credential cards in a closed shadow root, password and
  one-time code hidden by default with Show/Hide/Copy and auto-hide, key
  management dialog and settings page, English and Italian.
- Device-bound keys: AES-256-GCM under `HKDF(master key, device secret)`, the
  device secret only in an `HttpOnly` cookie; fixed expiry of at most 30 days;
  remove from this browser or from all browsers.
- Psono server pinning (`PSONO_SERVER_VERIFY_KEY`) with signature verification of
  `/info/`; cards warn and nothing is sent when the identity changes.
- CLI in the image: `print-server-pin`, `install-module`, `doctor`.
- Deployment examples (`deploy/`), `scripts/init-secrets.sh`, documentation,
  threat model, production checklist, ADRs.
- CI: tests, type check, Wiki.js compatibility (2.5.170, 2.5.300, current 2.x),
  repository hygiene check, CodeQL, dependency audit; release workflow with image
  provenance and SBOM.

### Known limitations
- Tested with Wiki.js 2.5.170 – 2.5.316 and Psono CE 7.4.5 only.
- nginx, Traefik and Apache proxy snippets are unverified (see
  `docs/deployment/reverse-proxy.md`).
- Wiki.js 2.x exposes its session cookie to scripts; the connector mitigates but
  cannot remove the risk of scripts running on the wiki origin (threat model R1).
