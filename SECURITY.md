# Security Policy

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

This project handles credentials, so security reports are taken seriously.

## Reporting a vulnerability

**Please report privately.** Use GitHub's **"Report a vulnerability"** (Security →
Advisories → *New draft security advisory*) on this repository. Do **not** open a
public issue, and never include real secrets, API keys, cookies or your master key
in a report.

Helpful to include: affected version, what an attacker needs (network position,
privileges), steps to reproduce against a test setup, and the impact you see.

This is a volunteer project: reports are handled on a best-effort basis. We
coordinate a fix and a disclosure date with you, and credit you in the advisory
unless you prefer otherwise.

## No warranty

This software is provided as is, without warranty, and has not been independently
audited; see the disclaimer in the [README](README.md#disclaimer--read-this-before-you-use-it)
and sections 15–16 of the [license](LICENSE).

## Supported versions

Only the latest release receives security fixes. The project is pre-1.0.

## Scope

In scope: the rendering module, the browser bundle, the sidecar, the container
image, the deployment examples and the documentation's security guidance.
Out of scope: vulnerabilities in Wiki.js, Psono, Docker or your reverse proxy —
please report those upstream (but do tell us if the connector's configuration
guidance should change because of them).

## Design guarantees and known limits

See the [threat model](docs/threat-model.md) — including its **residual risks**,
which administrators must accept or mitigate — and the
[production checklist](docs/deployment/production-checklist.md). In short: secrets
never appear in page HTML, the Wiki.js database, search indexes, logs or persistent
caches; user API keys are stored encrypted, bound to one browser, and are never
returned to any client; the Psono server's identity is pinned.
