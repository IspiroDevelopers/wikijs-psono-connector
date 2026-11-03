# Upgrading

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

This page describes how to move an existing installation to a newer version, with
**0.1.0 → 0.1.1** as the worked example. For a first installation see the
[installation guide](installation.md).

An upgrade touches two things, and **both** must be refreshed:

| Part | Where it runs | How you update it |
|---|---|---|
| Sidecar service (+ its PostgreSQL) | containers of the *connector's* Compose project | pull the new image, `up -d` |
| Rendering module `html-psono-connector` (carries the browser code) | inside the Wiki.js container | write it again, recreate Wiki.js |

Wiki.js itself is not touched. Allow about 10 minutes. The sidecar is unavailable
for a few seconds while it restarts; pages keep loading, cards show a short
"unavailable" message until it is back.

## What changes in 0.1.1

Drop-in upgrade: **no database migration and no configuration change are required.**
The full list is in the [changelog](../CHANGELOG.md).

- **Custom fields** are shown on the card. Text fields are visible like the notes;
  password-type fields stay hidden until *Show*/*Copy*
  ([ADR-0010](adr/0010-custom-fields.md)). This changes the **browser code, so the
  module must be written again** (step 2).
- The per-user limit for lookups is now configurable
  (`PSONO_CONNECTOR_RESOLVE_PER_MINUTE`, 30–10000) and defaults to **300** per
  minute instead of a fixed 120. Nothing to do unless you want another value.
- The sidecar now fails at start (before: at the first page view) if its build
  output is missing, and names the cause when its secret files are unreadable.

## Before you start

1. Note the current version: `docker compose images` in the connector's folder.
2. Read the [changelog](../CHANGELOG.md) of every version you skip.
3. Optional but cheap, a backup of the connector's database (the stored keys are
   unreadable without `master.key`, so keep that file too):

   ```sh
   cd /path/to/wikijs-psono-connector/deploy        # the folder with docker-compose.yml
   docker compose exec -T psono-connector-db pg_dump -U psono_connector psono_connector > backup-before-0.1.1.sql
   ```

## Step 1 — Update the sidecar

In the **connector's** folder, set the version in `docker-compose.yml`
(`:latest` needs no change, but pinning is recommended in production):

```yaml
    image: ghcr.io/ispirodevelopers/wikijs-psono-connector:0.1.1
```

Then pull and restart:

```sh
docker compose pull
docker compose up -d
docker compose exec psono-connector node main.cjs doctor
```

`doctor` must report no failures. If the container does not start, read
`docker compose logs psono-connector`: 0.1.1 names the cause of unreadable secret
files (`ENOENT`: wrong path in `connector.env`; `EACCES`: run
`sudo chown 1000:1000 master.key database.url`).

> **Building the image yourself?** Check out the tag instead and build:
> `git fetch --tags && git checkout v0.1.1 && docker compose build && docker compose up -d`.

## Step 2 — Write the module again

Same command as in [installation step 3](installation.md#step-3--install-the-module-into-wikijs);
replace `/path/to/wikijs` with the folder that holds **Wiki.js's** `docker-compose.yml`:

```sh
cd /path/to/wikijs-psono-connector/deploy
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" \
  -v "/path/to/wikijs/modules:/out" psono-connector node main.cjs install-module /out
```

It replaces the older copy in `/path/to/wikijs/modules/html-psono-connector`. The mount in Wiki.js's
compose file is unchanged. (Alternative without Docker: unpack
`wikijs-psono-connector-module-v0.1.1.tar.gz` from the
[release page](https://github.com/IspiroDevelopers/wikijs-psono-connector/releases)
into the same folder and check it with `sha256sum -c SHA256SUMS`.)

## Step 3 — Recreate Wiki.js

Wiki.js reads the module at start, so recreate it **from its own folder**:

```sh
cd /path/to/wikijs
docker compose up -d --force-recreate
docker compose logs wiki | grep -i "renderer"      # expect: Loaded 1 new renderers: [ OK ]
```

The container name may differ (`docker ps`). Wiki.js is unavailable for up to a minute while it starts.

## Step 4 — Check

1. `docker compose images` in the connector's folder shows `0.1.1`.
2. Open a page with a credential card and force a reload (**Ctrl+F5**), so the
   browser drops the old code. The card loads as before.
3. For an entry with custom fields, the fields appear below the one-time code. Fields
   of type *password* show a mask until you press *Show*.

Users do **not** have to enter their Psono API key again: keys, enrollments and the
database are unchanged.

## Roll back

There is no migration, so going back is safe: put the previous version in
`docker-compose.yml` (`:0.1.0`), run step 1, then step 2 **with that version's image**
(`install-module` comes from the image you are running) and step 3.

> Keep sidecar and module on the same version. A 0.1.1 module with a 0.1.0 sidecar
> works but shows no custom fields; a 0.1.0 module with a 0.1.1 sidecar ignores them.

## If something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| Cards unchanged, no custom fields | old module or cached browser code | repeat step 2 and 3, then Ctrl+F5 |
| `Loaded 0 new renderers` | the module folder is not mounted or has the wrong name | the folder must be `html-psono-connector`; see [troubleshooting](troubleshooting.md#wikijs-does-not-list-the-module) |
| Sidecar restarts in a loop | unreadable secret files or missing variable | `docker compose logs psono-connector`; see step 1 |
| Cards say "Too many requests" on pages with many credentials | per-user limit | raise `PSONO_CONNECTOR_RESOLVE_PER_MINUTE` ([configuration](configuration.md)) |
| Users are asked for their key again | `master.key` changed or the database was replaced | [troubleshooting](troubleshooting.md#users-lost-their-keys-after-an-update) |

Still stuck? Open an issue with the output of `doctor` and the versions.
