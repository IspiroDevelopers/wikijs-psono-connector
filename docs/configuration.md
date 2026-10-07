# Configuration reference

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

## Sidecar (environment variables)

Variables marked 🔑 also accept `<NAME>_FILE` pointing to a file (Docker
secrets). The sidecar refuses to start on any invalid value and names the
variable, never its content.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `PSONO_CONNECTOR_PUBLIC_URL` | ✔ | | Wiki origin as users type it (`https://wiki.example.com`). Used for the same-origin check. No path. |
| `PSONO_WEB_BASE_URL` | ✔ | | Psono web client base. Only links to exactly this scheme+host+port (and path) are resolved. |
| `PSONO_SERVER_VERIFY_KEY` | ✔ | | The Psono server's Ed25519 verify key (64 hex), shown as **"server signature"** in Psono's API key dialog. The connector talks to the server only while it proves this identity ([ADR-0009](adr/0009-psono-server-pinning.md)). Get it with `docker run --rm -e PSONO_API_BASE_URL=https://… IMAGE node main.cjs print-server-pin`. |
| `PSONO_API_BASE_URL` | ✔ | | Psono server API base, usually `<web>/server`. The only host the sidecar ever calls besides Wiki.js. |
| `WIKIJS_INTERNAL_URL` | ✔ | | How the sidecar reaches Wiki.js directly, e.g. `http://wikijs:3000`. Plain HTTP allowed (internal network). |
| `DATABASE_URL` 🔑 | ✔ | | PostgreSQL connection string for the connector's own database. |
| `PSONO_CONNECTOR_MASTER_KEY` 🔑 | ✔ | | 32 random bytes, hex (64 chars) or base64. Encrypts users' API keys. **Back it up**: without it, users must re-enter their keys. |
| `PSONO_CONNECTOR_MASTER_KEY_VERSION` | | `1` | Version number stored with each ciphertext. Increase when rotating. |
| `PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS` 🔑 | | | Decrypt-only old keys, `1:<key>,2:<key>`. Records are re-encrypted with the current key on next use. |
| `PSONO_CONNECTOR_ENABLED` | | `true` | Global switch. When `false`, links stay plain links and Psono is never called. Takes effect on restart, no re-rendering needed. |
| `PSONO_CONNECTOR_LOAD_MODE` | | `visible` | `visible`: load when a card scrolls into view. `click`: load only on click. |
| `PSONO_CONNECTOR_PASSWORD_VISIBLE_SECONDS` | | `30` | Revealed passwords **and one-time codes** are hidden and wiped from the page after this many seconds. Both are hidden by default and fetched only when the user clicks *Show* (or *Copy*). |
| `PSONO_CONNECTOR_REQUEST_TIMEOUT_MS` | | `8000` | Timeout for calls to Psono and Wiki.js. |
| `PSONO_CONNECTOR_TRUSTED_PROXIES` | | | Reverse proxies allowed to set `X-Forwarded-For`. See [below](#psono_connector_trusted_proxies). |
| `PSONO_CONNECTOR_DEVICE_TTL_DAYS` | | `30` | Days a browser stays enrolled before the user must enter the API key again (1–30). Fixed from enrollment, not extended by use. |
| `PSONO_CONNECTOR_LISTEN_HOST` | | `0.0.0.0` | Bind address inside the container. |
| `PSONO_CONNECTOR_LISTEN_PORT` | | `3100` | |
| `PSONO_CONNECTOR_ALLOW_HTTP` | | `false` | Accept `http:` Psono/wiki URLs. **Development only.** |
| `PSONO_CONNECTOR_LOG_LEVEL` | | `info` | `fatal` … `trace`. Logs never contain keys, secrets, cookies or secret ids (ids are hashed). |

### PSONO_SERVER_VERIFY_KEY (server pinning)

Protects against the Psono server being replaced, hijacked or impersonated:
the connector checks that Psono's signed `/info/` document still carries
exactly this key before it sends anything (API key id, secret ids).

1. Print it: `docker run --rm -e PSONO_API_BASE_URL=https://psono.example.com/server IMAGE node main.cjs print-server-pin`
2. **Compare it** with the "server signature" in Psono (Other → API keys → create/open a key) or with your Psono administrator — the command trusts the server on first use.
3. Put it in `connector.env`.

If the server later stops proving this identity, every credential card shows
a security warning, nothing is sent to it, and new keys are refused (removing
keys still works). The sidecar log has an `psono.server_changed` line. If you
changed the server on purpose (reinstall, key rotation), print the new key,
verify it as above and update the setting.

### PSONO_CONNECTOR_TRUSTED_PROXIES

Tells the sidecar which reverse proxies it may believe about the real client
IP. It only affects logs and the per-IP limit on failed logins — never who a
user is — but without it all clients look like the proxy.

Accepted values, separated by commas or spaces:

| Value | Trusts |
|---|---|
| `10.0.0.10` | exactly that proxy (recommended in production) |
| `10.0.0.0/24`, `fd00::/8` | a CIDR range |
| `uniquelocal` | any private-network address (10/8, 172.16/12, 192.168/16, fc00::/7) — the easy choice when the proxy is a container on the same Docker host |
| `loopback` | 127.0.0.1 / ::1 — proxy on the same host using host networking |
| `linklocal` | 169.254/16, fe80::/10 |

How to find the right value: **leave it empty, start the sidecar and open a
wiki page.** If requests come through an untrusted proxy, the log prints the
exact line to add, e.g.

```
Requests arrive through a reverse proxy at 10.0.0.10 that is not trusted ...
Set PSONO_CONNECTOR_TRUSTED_PROXIES=10.0.0.10 (or "uniquelocal" to trust any private-network proxy).
```

Typos fail at startup with a message naming the bad entry. The active value is
printed in the `started` log line.

### Key rotation

1. Generate a new key; set it as `PSONO_CONNECTOR_MASTER_KEY`, bump
   `PSONO_CONNECTOR_MASTER_KEY_VERSION`, move the old one to
   `PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS` as `<oldVersion>:<oldKey>`.
2. Restart. Each user's record is re-encrypted the next time it is used.
3. When you are confident all active users have been migrated, remove the old
   key. Users whose records still use it will simply be asked to re-enter
   their API key.

## Rendering module (Wiki.js → Administration → Rendering → HTML → Psono Connector)

| Setting | Meaning |
|---|---|
| *Psono web client URL* | Same value as `PSONO_WEB_BASE_URL`. Empty = module does nothing. Rerender all pages after changing it. |
| *Allow plain HTTP* | Development only. |

The module is off by default after installation.
