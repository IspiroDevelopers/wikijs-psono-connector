# Troubleshooting

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

**Start here:**

```sh
docker compose exec psono-connector node main.cjs doctor
```

It checks configuration, HTTPS, database, Wiki.js, the Psono server identity and
the proxy rule, and tells you what to fix. Its output contains no secrets, so it
is safe to paste into an issue. Then look up the symptom below.

## The links stay plain links (no card)

Plain links are the fail-safe state: something in the chain is off. In order:

1. **Is the script reachable through the URL users actually use?** Open
   `https://<your wiki>/psono-connector/client.js` in the browser. A Wiki.js
   error page (403/404) means the proxy rule is missing *for that hostname/port*
   — e.g. users reach Wiki.js directly on a port that bypasses the proxy.
2. **Are the links marked?** View the page source: the anchor must have
   `class="… psono-connector-link"` and `data-psono-secret-id`. If not: renderer
   disabled, *Psono web client URL* wrong (scheme, host and port must match the
   links exactly), or the page was not re-rendered (Utilities → Rerender All Pages).
3. **Is the script tag in place?** Theme → Code Injection must contain
   `<script src="/psono-connector/client.js" defer></script>`.
4. **Is the user signed in to Wiki.js?** Guests always see plain links.
5. **Is the connector enabled?** `PSONO_CONNECTOR_ENABLED` must not be `false`.
6. **Origin mismatch?** `PSONO_CONNECTOR_PUBLIC_URL` must equal the origin in the
   browser address bar (scheme, host, port). Otherwise the API answers
   `403 forbidden_origin`. Check the browser's network tab for
   `/psono-connector/api/…` responses.

## A card shows a message

| Message | Meaning | What to do |
|---|---|---|
| *Configure your Psono API key in this browser* | no key enrolled for this browser (or it expired) | click *Configure Psono*; see the [user guide](user-guide.md) |
| *Not available with your Psono API key* | Psono says no: the entry is not added to the key, the key is inactive, or the user lost access in Psono. Psono does not say which. | add the entry to the API key in Psono, or check the key is active |
| *Your Psono API key secret key is not valid* | the secret key does not decrypt Psono's answer | re-enter the key (the *secret key*, not the private key) |
| *The Psono server cannot be reached* | network/TLS problem between sidecar and Psono | `doctor`; check `PSONO_API_BASE_URL` and egress rules |
| **⚠ SECURITY WARNING: the identity of the Psono server has changed** | the server no longer signs with the pinned key — replaced, restored, rotated, or impersonated | **do not enter keys.** Find out why. If you changed the server on purpose, print and verify the new key (`print-server-pin`) and update `PSONO_SERVER_VERIFY_KEY` |
| *Too many requests* | rate limit | wait a minute |

## The sidecar will not start

The message names the variable. Common ones:

- `PSONO_SERVER_VERIFY_KEY is required` — run `print-server-pin`, verify, set it.
- `… must use https` — all public URLs need `https://` (development only: `PSONO_CONNECTOR_ALLOW_HTTP=true`).
- `…_FILE: cannot read "…" (EACCES)` — the secret file exists but the container user
  (uid 1000) may not read it, typically because it is owned by `root` with mode 600.
  On the host: `chown 1000:1000 master.key database.url` (keep mode 600), then
  `docker compose up -d --force-recreate psono-connector`.
- `…_FILE: cannot read "…" (ENOENT)` — the path is wrong. These variables hold paths
  **inside the container**: keep `/run/secrets/master_key` and `/run/secrets/database_url`
  from `connector.env.example` (Compose mounts your host files there); do not put the
  host file name or a host path.
- `PSONO_CONNECTOR_MASTER_KEY must be 32 random bytes` — generate with `openssl rand -hex 32`.
- `Database not ready, retrying…` — normal for a few seconds while PostgreSQL starts; if it persists check `DATABASE_URL` and that the database container is up.
- `Database schema is newer than this connector version` — you started an older image against a newer database; use the newer image.

## Wiki.js does not list the module

Administration → Rendering must show *Psono Connector* at the bottom of the list
(hard-refresh the page), and the Wiki.js log must show
`Loaded 1 new renderers: [ OK ]` after recreating its container. Check in order:

1. **Is the mount in the right compose file?** It belongs in the compose file of
   **Wiki.js**, under the Wiki.js service's `volumes:` — not in the connector's.
   Running `docker compose up -d wiki` in the connector's folder fails with
   *no such service*; recreate Wiki.js from **its own** folder.
2. **Is the path right?** A relative path (`./modules/…`) is relative to the Wiki.js
   compose file. If the module lives elsewhere, use the absolute host path.
3. **Did it arrive inside the container?**
   `docker exec <wikijs container> ls /wiki/server/modules/rendering/html-psono-connector`
   must list `definition.yml` and `renderer.js`. If the folder is missing or empty the
   mount line is absent or points at the wrong place.
4. **Was the container recreated?** A mount added to the compose file only takes
   effect after `docker compose up -d` (not `restart`).
5. The folder name must be exactly `html-psono-connector`.

## Logs say a reverse proxy is "not trusted"

Set `PSONO_CONNECTOR_TRUSTED_PROXIES` to the value the log suggests (an IP, a
CIDR, or `uniquelocal`). See [configuration.md](configuration.md).

## Users lost their keys after an update

Expected only when the master key changed or the database was replaced: stored
keys cannot be decrypted without the original `master.key`. Users re-enter their
key. After a deliberate master key rotation, keep the old key in
`PSONO_CONNECTOR_PREVIOUS_MASTER_KEYS`. Keys also expire 30 days after they were
entered, by design.

## Still stuck

Open an issue (template included) with the `doctor` output, versions and the
relevant log lines. **Never** paste API keys, passwords, one-time codes, cookies
or the master key. Security problems: [SECURITY.md](../SECURITY.md).
