# Reverse proxy configuration

<!-- SPDX-License-Identifier: AGPL-3.0-only -->

> [!CAUTION]
> **HTTPS IS REQUIRED.** Run Wiki.js, the connector and Psono **only over HTTPS**
> (Wiki.js *Administration → General → Site URL* must start with `https://`).
> Over plain HTTP, users' Psono API keys, passwords, one-time codes and the
> Wiki.js session cookie travel **in clear text** and can be intercepted by
> anyone on the network path. The sidecar refuses `http://` URLs unless
> `PSONO_CONNECTOR_ALLOW_HTTP=true`, which exists **for local development only**;
> the browser UI shows a red warning whenever a page is not served over HTTPS.

The connector needs exactly one routing rule in front of Wiki.js:

| Path on the public wiki URL | Goes to |
|---|---|
| `/psono-connector/…` | the connector sidecar (default port `3100`), **path unchanged** |
| everything else | Wiki.js, as today |

Why: the browser bundle runs inside wiki pages and must call the sidecar on the
**same origin** (`https://wiki.example.com`), so that the Wiki.js login cookie is
sent and the sidecar can ask Wiki.js who the user is. Wiki.js itself cannot
forward paths, so the proxy does it. See
[ADR-0007](../adr/0007-reverse-proxy-is-bring-your-own.md).

Pick the section that matches your setup:

- [A. nginx on a separate machine](#a-nginx-on-a-separate-machine) (e.g. a DMZ VM)
- [B. nginx on the same host](#b-nginx-on-the-same-host)
- [C. Caddy](#c-caddy)
- [D. Traefik (Docker labels)](#d-traefik-docker-labels)
- [E. Apache httpd](#e-apache-httpd)
- [F. No reverse proxy yet](#f-no-reverse-proxy-yet)

Then run the [checks](#verify) at the end.

> Verification status: **Caddy** (C, F) is what the project's development setup
> runs. The **nginx** snippets (A, B) use standard directives but have not yet been
> confirmed by the maintainers in a production setup; Traefik and Apache are
> unverified. Always run the *Verify* checks at the end and report what you find.

## Rules that apply to every proxy

1. **Do not strip the prefix.** The sidecar expects requests at
   `/psono-connector/...`. In nginx this means `proxy_pass http://host:3100;`
   **without** a trailing path.
2. **Do not cache** anything under `/psono-connector/`. The sidecar already sends
   `Cache-Control: no-store`; make sure no `proxy_cache`, CDN or "cache
   everything" rule overrides it.
3. **Pass cookies and the original scheme/IP**: `Cookie` (default),
   `X-Forwarded-For`, `X-Forwarded-Proto`.
4. **Give `/psono-connector/` precedence** over generic rules (e.g. nginx regex
   locations for `\.js$` static files).
5. **The sidecar is not a public service.** Only the proxy should be able to
   reach its port.

6. **Volumetric limits belong here.** The sidecar limits requests *per signed-in
   user* (see `PSONO_CONNECTOR_RESOLVE_PER_MINUTE`), but flooding with anonymous
   requests is best stopped by the proxy. Optional nginx example (unverified —
   keep `burst` above the number of credentials on your largest page):

   ```nginx
   # http { } context
   limit_req_zone $binary_remote_addr zone=psono_connector:10m rate=30r/s;
   # inside the `location ^~ /psono-connector/` block
   limit_req zone=psono_connector burst=100 nodelay;
   ```

Matching sidecar settings (see `docs/configuration.md`):

```env
# Public URL of the wiki, exactly as users type it. Used for the CSRF origin check.
PSONO_CONNECTOR_PUBLIC_URL=https://wiki.example.com
# Proxies allowed to report the client IP: an IP, a CIDR, or "uniquelocal" for
# any private-network proxy. Leave empty at first: the log prints what to set.
PSONO_CONNECTOR_TRUSTED_PROXIES=10.0.0.10
# How the sidecar reaches Wiki.js directly (not through the proxy).
WIKIJS_INTERNAL_URL=http://wikijs:3000
```

## A. nginx on a separate machine

Typical layout: `nginx VM (10.0.0.10)` → `wiki VM (10.0.0.20)` where Wiki.js
listens on port 3000 (or 80) and the sidecar on 3100.

**On the wiki VM**, publish the sidecar port on the LAN interface only and
allow only the nginx VM:

```yaml
# docker-compose.yml on the wiki VM
services:
  psono-connector:
    ports:
      - "10.0.0.20:3100:3100"   # LAN IP of the wiki VM, not 0.0.0.0
```

```sh
# ufw example — adapt to your firewall
sudo ufw allow from 10.0.0.10 to any port 3100 proto tcp
sudo ufw deny 3100/tcp
```

> Docker publishes ports through its own iptables chain, which can bypass
> `ufw`. Binding to a specific IP (as above) or using the `DOCKER-USER` chain is
> what actually restricts access. Verify from a third machine that port 3100 is
> **not** reachable.

**On the nginx VM**, add one `location` to the existing wiki `server` block:

```nginx
upstream wikijs_psono_connector {
    server 10.0.0.20:3100;
    keepalive 8;
}

server {
    listen 443 ssl;
    server_name wiki.example.com;
    # ... your existing TLS settings ...

    # Wiki.js Psono Connector — must stay above generic/regex locations.
    location ^~ /psono-connector/ {
        proxy_pass http://wikijs_psono_connector;   # no trailing path: keep the prefix
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        client_max_body_size 16k;
        proxy_cache off;
        proxy_buffering off;
    }

    # Your existing Wiki.js location, unchanged.
    location / {
        proxy_pass http://10.0.0.20:3000;
        # ...
    }
}
```

`^~` makes this prefix win over regex locations such as
`location ~* \.(js|css)$ { expires 30d; }`, which would otherwise cache the
connector's bundle and API.

Reload: `sudo nginx -t && sudo systemctl reload nginx`.

## B. nginx on the same host

Same `location` as in A, with the sidecar bound to loopback:

```yaml
services:
  psono-connector:
    ports:
      - "127.0.0.1:3100:3100"
```

```nginx
location ^~ /psono-connector/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 16k;
    proxy_cache off;
}
```

If nginx itself runs in the same Docker network, use
`proxy_pass http://psono-connector:3100;` and do not publish the port at all.

## C. Caddy

```caddyfile
wiki.example.com {
    handle /psono-connector/* {
        reverse_proxy psono-connector:3100
    }
    handle {
        reverse_proxy wikijs:3000
    }
}
```

`handle` (not `handle_path`) keeps the prefix. Caddy sets `X-Forwarded-*`
automatically.

## D. Traefik (Docker labels)

> ⚠️ Not yet verified by the project's tests. Reports welcome.

```yaml
services:
  psono-connector:
    labels:
      - traefik.enable=true
      - traefik.http.routers.psono-connector.rule=Host(`wiki.example.com`) && PathPrefix(`/psono-connector/`)
      - traefik.http.routers.psono-connector.priority=100
      - traefik.http.routers.psono-connector.entrypoints=websecure
      - traefik.http.routers.psono-connector.tls=true
      - traefik.http.services.psono-connector.loadbalancer.server.port=3100
```

The higher `priority` makes this router win over the Wiki.js `Host(...)` router.
Do not add a `StripPrefix` middleware.

## E. Apache httpd

> ⚠️ Not yet verified by the project's tests. Reports welcome.

```apache
ProxyPreserveHost On
ProxyPass        /psono-connector/ http://10.0.0.20:3100/psono-connector/
ProxyPassReverse /psono-connector/ http://10.0.0.20:3100/psono-connector/
# Existing Wiki.js rules go *after* this one:
ProxyPass        / http://10.0.0.20:3000/
ProxyPassReverse / http://10.0.0.20:3000/
```

Requires `mod_proxy` and `mod_proxy_http`. Apache matches `ProxyPass` in
order, so the connector rule must come first.

## F. No reverse proxy yet

If Wiki.js publishes its ports directly, start the optional Caddy service from
the example compose file:

```sh
docker compose --profile proxy up -d
```

Then remove the `ports:` mapping from the Wiki.js service so that only Caddy is
exposed. Caddy obtains TLS certificates automatically when
`PSONO_CONNECTOR_PUBLIC_URL` uses a public DNS name.

## Verify

Run from a browser machine (replace the host):

```sh
# 1. Routed to the sidecar, not to Wiki.js (expects JSON with "status": "ok")
curl -s https://wiki.example.com/psono-connector/healthz

# 2. Not cached by the proxy (expects "no-store")
curl -sI https://wiki.example.com/psono-connector/client.js | grep -i cache-control

# 3. Without a Wiki.js login the API refuses (expects 401)
curl -s -o /dev/null -w '%{http_code}\n' https://wiki.example.com/psono-connector/api/me/status

# 4. The sidecar port is NOT reachable directly from outside (expects a timeout/refusal)
curl -m 5 http://10.0.0.20:3100/psono-connector/healthz
```

Finally, open a wiki page while logged in and check the browser developer tools:
requests to `/psono-connector/api/...` must carry the `jwt` cookie and return
200.
