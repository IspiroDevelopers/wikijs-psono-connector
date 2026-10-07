# Development

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

## Setup

Node.js ≥ 20 (`.nvmrc` pins 24) **or** only Docker — `scripts/dev-node.sh` runs any
command in a throwaway `node:24-alpine` container with the repo mounted:

```sh
scripts/dev-node.sh npm ci --ignore-scripts
scripts/dev-node.sh npm run check        # typecheck + tests + build
```

| Command | What |
|---|---|
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | unit + integration tests (Vitest) |
| `npm run build` | `dist/wikijs-module/`, `dist/sidecar/` (bundled, no `node_modules` needed) |
| `npm run test:compat` | loads the built module inside official Wiki.js images and runs the real sanitizer (needs Docker and a prior `build`) |
| `sh scripts/check-repo.sh` | hygiene: SPDX headers, no secret files/keys, optional private-strings denylist |

## Tests

- `test/unit` — URL matcher (including bypass attempts), TOTP (RFC 6238 vectors),
  cipher/store, Psono client, server pinning, config, doctor.
- `test/integration` — renderer + sanitizer pipeline; the sidecar HTTP API with
  in-memory storage and stubbed Wiki.js/Psono (real crypto on both sides); the
  browser bundle in jsdom.
- `test/live` — against a **real, throwaway Psono**; skipped unless
  `PSONO_TEST_*` variables are set (see the file header). Never point it at a
  production Psono. Keep the keys in an untracked env file (`TEST_*` and `*.env`
  are git-ignored).

Rules for tests: fixtures are synthetic; no real hostnames, keys or passwords; a
security-relevant fix needs a test that fails without it.

## Running the whole stack locally

1. Run a Psono "combo" container and a Wiki.js (both plain HTTP is fine **for
   development**), create a Psono API key and add an entry to it.
2. Build the image: `docker build -t wikijs-psono-connector:dev .`
3. Use `deploy/docker-compose.yml` with `image: wikijs-psono-connector:dev` and
   in `connector.env`: `PSONO_CONNECTOR_ALLOW_HTTP=true`, the plain-HTTP URLs, and
   a Caddy/nginx giving Wiki.js and `/psono-connector/` one origin.
4. `docker compose exec psono-connector node main.cjs doctor`.

## Conventions

- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only`
  (checked by `scripts/check-repo.sh`).
- Comments explain **why** and the constraint, not what the line does. Reference
  the ADR when a rule comes from a decision.
- Anything shown to users goes through `src/client/i18n.ts` (English and Italian;
  add a language by adding an object).
- Secret-bearing values are never logged, never put in URLs, DOM attributes or
  storage; `textContent` only, never `innerHTML`.
- Decisions that change architecture or security properties get an ADR in
  `docs/adr/` (copy the latest, bump the number, link it from the index).

## Repository settings (maintainers)

Settings the project assumes on GitHub (Settings → …):

- **General:** default branch `main`; Issues on; Wikis, Projects, Sponsorships
  off; pull requests: allow squash merging only, *Automatically delete head
  branches* on.
- **Code security:** *Private vulnerability reporting* **on** (SECURITY.md relies
  on it), Dependency graph, Dependabot alerts and security updates, Secret
  scanning and **Push protection** on. CodeQL runs from `.github/workflows/codeql.yml`.
- **Rules → Rulesets:** on `main` block force-push and deletion, require the `CI`
  (`test`) and `CodeQL` checks, require a pull request; on tags `v*` restrict
  creation, update and deletion to maintainers.
- **Actions:** allow actions from GitHub and from `docker/*` only; default
  workflow permissions *read*; do not let Actions approve pull requests; require
  approval for workflows from first-time contributors.
- **Packages:** after the first release set the `wikijs-psono-connector` container
  package to *public* (new packages start private).
- **Personal account (so commits do not publish an e-mail address):** Settings →
  Emails → *Keep my email addresses private* and *Block command line pushes that
  expose my email*; commit with the `…@users.noreply.github.com` address.

## Releasing

1. Update `CHANGELOG.md` and the version in `package.json` / `connector.manifest.json`.
2. `sh scripts/check-repo.sh --release` must pass (no `OWNER` placeholders).
3. `git tag vX.Y.Z && git push --tags`. The *Release* workflow re-runs the gate,
   builds and pushes `ghcr.io/<owner>/wikijs-psono-connector` (with provenance and
   SBOM) and attaches the Wiki.js module tarball + checksums to the GitHub release.
