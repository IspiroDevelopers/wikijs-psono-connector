# ADR-0002: The placeholder is a plain, sanitizer-safe anchor

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-10-07)
- Supersedes: spec v1 §7.1 (`<div>` + `<noscript>`), §20.6 (custom element in page HTML)

## Context

Wiki.js sanitizes page HTML with DOMPurify. Tested on 2.5.316: `<noscript>` and
unknown custom elements are removed, `<a>` with `class` and `data-*` is kept.
Page HTML is cached at save time, so anything decided in the renderer is frozen
until "Rerender all pages".

## Decision

The renderer turns a matching link into:

```html
<a href="https://psono.example.com/index.html#!/datastore/search/<uuid>"
   class="psono-connector-link"
   data-psono-secret-id="<uuid>"
   rel="noopener noreferrer">original text</a>
```

The frontend bundle enhances these anchors at runtime (it may mount a custom
element or shadow DOM *client-side*). The renderer runs in the default pre step
so its output is still sanitized.

## Consequences

- No JS, connector disabled, or sidecar down ⇒ a normal working link.
- The global on/off switch takes effect immediately, without re-rendering: the
  bundle asks the sidecar for status before enhancing.
- Changing the Psono host still requires re-rendering (documented).
