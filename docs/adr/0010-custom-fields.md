# ADR-0010: Custom fields are shown by kind, secret kinds only on request

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

- Status: Accepted (2026-11-03)
- Relaxes: the rule "custom fields never leave the sidecar" of the first allow-list

## Context

Teams keep useful data in Psono custom fields (customer number, environment,
support PIN). Until now the sidecar dropped all of them, so a card showed less than
the entry in Psono. A Psono custom field has a name, a value and a kind: `text` or
`password` (entries from older Psono versions have no kind).

## Decision

1. Custom fields of website passwords, application passwords, notes and bookmarks
   are read, at most 50 per entry, names cut at 200 characters, values at the usual
   10 000 characters. Empty or malformed fields are ignored.
2. Kind `text` (or no kind) is metadata: name and value are part of the resolve
   answer, shown like the notes.
3. **Every other kind is secret**, including kinds this version does not know. The
   resolve answer carries only the name and the position. The value is returned by
   `POST /secrets/field` (position **and** name must match, so an entry changed in
   the meantime never answers with another field), under the same per-user limit as
   the password reveal, and the card wipes it after the visibility window.
4. Values never appear in logs; the field endpoint logs the short secret reference only.

## Consequences

- Text-type custom fields are as visible as the notes: anyone who can resolve the
  link (ADR-0005: no Wiki.js page check) sees them. Users must keep secrets in
  password-type fields; this is stated in the user guide.
- No configuration or database change. The browser bundle changes, so the Wiki.js
  module is copied again when updating.

## Alternatives rejected

- Showing every custom field in clear: a password-type field would leak to the page.
- Hiding every custom field behind Show: needless friction for plain metadata.
- Letting the browser send the field kind: the kind is decided by the sidecar from
  the decrypted secret only.
