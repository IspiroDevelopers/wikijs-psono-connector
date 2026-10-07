# Research: Psono links, API keys and secret access

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

Sources inspected on 2026-10-07:

- `psono-client` @ `2f7a62a` (2026-09-09), Apache-2.0 — https://gitlab.com/esaqa/psono/psono-client
- `psono-server` (default branch, shallow clone), Apache-2.0 — https://gitlab.com/esaqa/psono/psono-server
- https://doc.psono.com/user/api-key/overview.html
- https://doc.psono.com/user/api-key/usage-without-session-and-local-decryption.html

## Link formats produced by the web client

The client uses a `HashRouter` with `hashType="hashbang"`
(`src/js/index.js:98`), so routes live in the URL **fragment** after `#!`.

| Link | Source | Connector behaviour |
|---|---|---|
| `<web>/index.html#!/datastore/search/<secret_id>` | "Entry link" shown in the entry dialog, advanced section (`components/dialogs/edit-entry.js:4324`); also `services/secret.js:330` | **Primary supported format** |
| `<web>/index.html#!/datastore/edit/<type>/<secret_id>` | route `views/index.js:287` | Supported |
| `<web>/open-secret.html#!/secret/<type>/<secret_id>` | `services/secret.js:362` | Supported |
| `<web>/link-share-access.html#!/link-share-access/<id>/<linkShareSecret>/<server>[/<verifyKey>]` | `views/index.js:147` | **Never transformed.** The URL itself contains decryption material. Leave it untouched and document that such links should not be pasted into a wiki. |
| Anything else on the Psono host | — | Left as a normal link |

`secret_id` is a UUID. The parser must accept only a canonical UUID and reject
anything else.

## API key model (server-side facts)

API keys carry the flags `restrict_to_secrets`, `read`, `write`,
`allow_insecure_access` (`psono-client src/js/services/api-client.js:2744`).

The session-less endpoint is `POST {server}/api-key-access/secret/`
(`psono-server restapi/views/api_key_access_secret.py`, serializer
`restapi/serializers/read_secret_with_api_key.py`):

- Permission class `AllowAny`; request body `{ api_key_id, secret_id }`. No
  request signature.
- The secret is found only via an **explicit `API_Key_Secret` link** between
  the API key and the secret, with `api_key.read = true`, `api_key.active = true`,
  owner `is_active = true`, **and** the owner must still have read rights on the
  secret (`user_has_rights_on_secret`).
  - ⇒ **Every secret referenced in the wiki must be explicitly added to the
    user's API key.** This holds even for keys that are not
    `restrict_to_secrets`, because the lookup goes through `API_Key_Secret`.
  - ⇒ Revoking the user's access in Psono immediately revokes access through the
    connector.
- Without `api_key_secret_key` in the body, the response is
  `{ data, data_nonce, secret_key, secret_key_nonce, read_count, write_date }`
  — still encrypted (**local decryption**).
- With `api_key_secret_key`, the server decrypts and returns plaintext
  (**remote decryption**). It is refused unless `allow_insecure_access = true`.
- Every call increments `secret.read_count`.
- "Not found" and "no permission" are indistinguishable:
  `400 NO_PERMISSION_OR_NOT_EXIST` in the source. **Observed on release 7.4.5
  (2026-10-07): the body is only the text `non_field_errors`**, with no code.
  Because the connector never sends `api_key_secret_key`, the only possible
  non-field error is this one; the client accepts both forms. The connector
  reports one state: *"not available with your Psono API key"*.

### Local decryption

1. `secret_key = SecretBox(api_key_secret_key).decrypt(hex(secret_key), hex(secret_key_nonce))`
2. `data_json = SecretBox(secret_key).decrypt(hex(data), hex(data_nonce))`

`SecretBox` is NaCl XSalsa20-Poly1305 with hex encoding. Use a maintained
library (`tweetnacl` / `libsodium-wrappers`), never hand-rolled crypto, and test
against vectors generated with the official server code.

### Key material actually needed

For local decryption the connector needs only **`api_key_id` and
`api_key_secret_key`**. The API key `private_key` (used for session-based login)
is **not** required and must not be requested or stored.

### Recommended API key settings for users

- `read = true`, `write = false`
- `allow_insecure_access = false` (makes server-side decryption impossible even
  if the key leaks)
- `restrict_to_secrets = true`, with only the secrets used in the wiki added

### Secret data fields

Decrypted `data` is JSON with type-prefixed keys, e.g.
`website_password_title`, `website_password_url`, `website_password_username`,
`website_password_password`, `website_password_notes`,
`website_password_totp_code|period|digits|algorithm`; TOTP entries use
`totp_code|period|digits|algorithm`. The exact per-type mapping is defined in
Phase 5 from `psono-client src/js/services/item-blueprint.js`.

## Licensing

Both `psono-client` and `psono-server` are Apache-2.0. Apache-2.0 code may be
incorporated into an AGPL-3.0 work (one-way compatible). If any code is reused,
keep its copyright header, ship the Apache-2.0 text and any `NOTICE` content,
and list it in `THIRD_PARTY_NOTICES.md`.
