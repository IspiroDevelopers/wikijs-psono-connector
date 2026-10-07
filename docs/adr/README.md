# Architecture Decision Records

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Short records of decisions that shape the architecture or the security
properties, with the reasons and the alternatives rejected. Add one when you
change such a decision (copy the latest, take the next number).

| # | Decision | Status |
|---|---|---|
| [0001](0001-sidecar-architecture.md) | Backend as a sidecar service behind a reverse proxy | Accepted |
| [0002](0002-placeholder-is-a-plain-anchor.md) | The placeholder is a plain, sanitizer-safe anchor | Accepted |
| [0003](0003-identity-via-wikijs-graphql.md) | User identity is delegated to Wiki.js via public GraphQL | Accepted |
| [0004](0004-psono-sessionless-local-decryption.md) | Psono access via session-less API key with local decryption | Accepted (storage part superseded by 0008) |
| [0005](0005-no-wiki-page-acl-check.md) | No Wiki.js page-permission check on secret resolution | Accepted |
| [0006](0006-user-api-key-onboarding.md) | How users enter their Psono API key (write-only, always manageable) | Accepted (storage part superseded by 0008) |
| [0007](0007-reverse-proxy-is-bring-your-own.md) | The reverse proxy is bring-your-own | Accepted |
| [0008](0008-device-bound-keys.md) | API keys are bound to the browser and expire after 30 days | Accepted |
| [0009](0009-psono-server-pinning.md) | The Psono server's identity is pinned | Accepted |
