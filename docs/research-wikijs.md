# Research: Wiki.js 2.x extension points

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Inspected target: Wiki.js **2.5.316** (`ghcr.io/requarks/wiki:2`, Node 24.13.0,
PostgreSQL 17), on 2026-10-07. Paths below are relative to `/wiki/server` inside
the official image.

## Summary

| Need of the connector | Official extension point? | Decision |
|---|---|---|
| Transform links in page HTML | **Yes** — rendering modules (`modules/rendering/*`) | Ship a rendering module |
| Global settings (enable, endpoint) | **Yes** — rendering module `props`, editable in Admin → Rendering | Use renderer props for page-level settings |
| Load a frontend bundle | **Yes** — Admin → Theme → Code Injection (head/body), or an analytics module `code.yml` | Inject one `<script>` tag |
| Backend HTTP routes | **No** | Separate service behind a reverse proxy (ADR-0001) |
| Identify the logged-in user | **Yes** — public GraphQL API (`users.profile`) | Sidecar forwards the user's JWT (ADR-0003) |
| Per-user settings UI / storage | **No** | Sidecar serves its own page and owns its own DB tables |
| Migrations for plugin tables | **No** | Sidecar runs its own migrations |
| Admin UI pages | **No** (precompiled Vue bundle, no sources in the image) | Renderer props + sidecar admin page |

## Module discovery

Every module type is discovered by scanning `modules/<type>/*/definition.yml` at
boot (`models/renderers.js:39`, and the same pattern in `models/analytics.js`,
`authentication.js`, `commentProviders.js`, `editors.js`, `loggers.js`,
`searchEngines.js`, `storage.js`). New modules are inserted into the DB with
`enabledDefault` and default `props`; removed folders are deleted from the DB.

A module can therefore be installed by **bind-mounting its folder** into the
container. No core file is modified, and the mount survives image upgrades.

### Gotcha: folder name must equal kebab-case of `key`

`modules/rendering/html-core/renderer.js:26` loads children with
`require(\`../${_.kebabCase(child.key)}/renderer.js\`)`. A module with
`key: htmlPsonoConnector` **must** live in `html-psono-connector/`.

### Gotcha: rendered HTML is cached at save time

Page HTML is produced when the page is saved and stored in the DB. After
installing, removing or reconfiguring the renderer, an admin must run
**Admin → Utilities → Rerender all pages**. This is why the placeholder stays a
plain `<a>` and the enable/disable switch is evaluated at runtime (ADR-0002).

## Rendering pipeline and sanitization

`html-core` runs children with `step` ≠ `post` on a cheerio DOM, then
`step: post` children ordered by `order` on the HTML string. `html-security`
is `step: post`, `order: 99999` and runs DOMPurify 3.3.1 with
`ADD_TAGS: ['tabset','template']` (+ optional `foreignObject`, `iframe`).

Tested against the real sanitizer inside the container:

| Input | Output |
|---|---|
| `<a href="https://psono…" class="psono-link" data-psono-ref="…" rel="noopener noreferrer">` | **kept intact** |
| `<div class="…" data-…><noscript><a …></a></noscript></div>` | `<noscript>` and its content **removed** |
| `<wikijs-psono-secret data-reference="…">` | element **removed** (text kept) |
| `<a href="javascript:…" data-psono-ref="…">` | `href` **removed** |

Conclusion: the placeholder must be a standard `<a>` with `class` and `data-*`.
The renderer must run in the default (pre) step so its output is still
sanitized by `html-security` — never `step: post` with `order > 99999`.

## HTTP stack and why in-process routes were rejected

`master.js` registers, in order: security headers, `/_assets` static,
cookie parser, session, passport + `WIKI.auth.authenticate`, body parsers,
GraphQL (`master.js:96` → `WIKI.servers.startGraphQL()`), the `auth`, `upload`
and `common` controllers, then a catch-all **404** (`master.js:174`) and the
error handler.

The only code hook that executes arbitrary module code at boot regardless of
admin settings is `core/extensions.js`, which `require`s every
`modules/extensions/*/ext.js`. It runs in `postBootMaster`
(`core/kernel.js:81`), i.e. **after** the 404 handler is registered. Routes
added there are unreachable unless spliced into Express internals
(`app._router.stack`). That is a runtime monkey-patch of undocumented
internals, runs with full access to `WIKI.*` and the Wiki.js DB, and would put
the connector master key inside the Wiki.js process. Rejected (ADR-0001).

## Authentication

- JWT (RS256) is read from `Authorization: Bearer` **or** the `jwt` cookie
  (`helpers/security.js:27`). Expired tokens are transparently refreshed by
  `WIKI.auth.authenticate` and returned in a `new-jwt` response header.
- `query { users { profile { id name email isActive } } }` throws
  `AuthRequired` (1019) for anonymous/guest (`id === 2`) and `AuthAccountBanned`
  for inactive users (`graph/resolvers/user.js:59`). This is the identity check
  used by the sidecar.
- There is **no read-level GraphQL query** to check page access:
  `pages.singleByPath` requires `manage:pages` or `delete:pages`
  (`graph/resolvers/page.js:179`). See ADR-0005.
- Note: Wiki.js returns GraphQL error stack traces to clients. The sidecar must
  never relay Wiki.js error bodies to the browser.

## Frontend

The client is a precompiled Vue 2 bundle under `/wiki/assets/js`; there are no
sources in the image. Extending the Vue UI requires a rebuild — out of scope.
Page navigation is mostly full page loads, which simplifies cleanup, but the
bundle must still handle `pagehide`/`visibilitychange`.
