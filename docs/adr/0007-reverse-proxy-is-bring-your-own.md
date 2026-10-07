# ADR-0007: The reverse proxy is bring-your-own; we document it, we don't ship it

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Refines: ADR-0001

## Context

The browser bundle must reach the sidecar on the **same origin** as Wiki.js so
the Wiki.js `jwt` cookie is sent and no CORS is needed (ADR-0001, ADR-0003).
Wiki.js cannot forward a path to another service, so something in front of it
must route `/psono-connector/` to the sidecar.

Real deployments differ:

- an existing nginx/Apache/HAProxy on **another machine** (e.g. a DMZ VM);
- an existing proxy on the **same host** (nginx, Caddy, Traefik labels, …);
- no proxy at all: Wiki.js publishes its ports directly.

Shipping a mandatory proxy would conflict with the first two cases, which are
the common ones in production.

## Decision

- The connector ships **only the sidecar** (a container image listening on one
  HTTP port, default `3100`) plus the Wiki.js rendering module.
- The proxy contract is small and documented in
  [`docs/deployment/reverse-proxy.md`](../deployment/reverse-proxy.md) with
  snippets for nginx (same host and separate host), Caddy, Traefik and Apache.
  Caddy is what the project's development deployment uses; the other snippets
  use standard directives and are marked as unverified until someone confirms
  them in a real setup (reports welcome). The contract:
  1. forward `/psono-connector/` **unchanged** (no prefix stripping) to the
     sidecar;
  2. forward everything else to Wiki.js as before;
  3. do not cache `/psono-connector/`; pass `Cookie`, set
     `X-Forwarded-For` / `X-Forwarded-Proto`.
- The example `docker-compose.yml` contains an **optional** Caddy service behind
  a compose profile (`--profile proxy`) for installs without any proxy.
- The sidecar does **not** derive security decisions from `Host` or
  `X-Forwarded-*`: the CSRF origin check compares against the configured
  `PSONO_CONNECTOR_PUBLIC_URL`, and rate limits are keyed by Wiki.js user id.
  `X-Forwarded-For` is honoured only from `PSONO_CONNECTOR_TRUSTED_PROXIES`, and
  only for logging.
- The sidecar calls Wiki.js GraphQL on an **internal** URL
  (`WIKIJS_INTERNAL_URL`, e.g. `http://wikijs:3000`), not through the public
  proxy.

## Consequences

- Users with an existing proxy add one `location`/route; nothing else changes.
- When the proxy is on another machine, the sidecar port is reachable on the
  LAN: the docs require binding it to the LAN interface and firewalling it to
  the proxy's IP, exactly like the Wiki.js upstream port.
- A misconfigured proxy fails closed: requests without the Wiki.js cookie or
  with a foreign `Origin` are rejected; the links stay plain links.
