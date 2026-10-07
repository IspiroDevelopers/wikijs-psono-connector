# Contributing

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Thanks for helping. This project handles credentials, so changes are reviewed with
security first; the rules below keep that fast.

## Ground rules

- **Security problems go to the private channel** in [SECURITY.md](SECURITY.md), not to a public issue.
- **Never** put real API keys, passwords, one-time codes, cookies, hostnames of your
  infrastructure or screenshots showing them in issues, pull requests, tests or fixtures.
- By contributing you agree that your contribution is licensed under
  **AGPL-3.0-only** (the project license). Add the SPDX header to new source files:
  `// SPDX-License-Identifier: AGPL-3.0-only`.
- Be kind: see the [Code of Conduct](CODE_OF_CONDUCT.md).

## Workflow

1. Open an issue first for anything larger than a small fix.
2. Fork, branch, make the change **with tests** (a security-relevant fix needs a
   test that fails without it).
3. Run `npm run check` and `sh scripts/check-repo.sh` ([development guide](docs/development.md);
   Docker alone is enough: `scripts/dev-node.sh npm run check`).
4. Update the docs, the [changelog](CHANGELOG.md) and — if you change architecture
   or security properties — add an [ADR](docs/adr/README.md).
5. Open a pull request; the template has the checklist.

## What gets extra scrutiny

- anything that adds data to what the browser receives (the allow-list in
  `src/sidecar/psono/secret-mapper.ts`), new endpoints, or new things stored;
- logging (never secrets, cookies, API keys, OTP codes; secret ids only hashed);
- DOM code (`textContent` only, never `innerHTML` with data);
- dependencies: the sidecar has three direct runtime dependencies on purpose; new
  ones need a justification.

## Translations

User-visible text lives in `src/client/i18n.ts`. To add a language, add an object
with the same keys and select it in `strings()`.
