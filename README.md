<h1 align="center">AdGuard Atlas</h1>

<p align="center">
  Watch your network's DNS traffic as animated arcs on a world map.<br>
  A real-time dashboard for <a href="https://github.com/AdguardTeam/AdGuardHome">AdGuard Home</a>.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933">
  <img alt="Docker ready" src="https://img.shields.io/badge/docker-ready-2496ED">
</p>

<!-- Add a screenshot or GIF here, e.g. docs/screenshot.png -->
<!-- ![AdGuard Atlas](docs/screenshot.png) -->

AdGuard Atlas polls the query log of your AdGuard Home instance, geolocates the servers your devices talk to,
and draws a live arc from your location to each destination. Every query is one arc: where it goes, what kind of
record it was, and which device asked for it.

## Features

- **Live world map**: animated arcs with domain labels and an arrival pulse, on a flat map or a globe
- **Two color modes**, switchable with one click:
  - by **DNS record type** (A, AAAA, CNAME, HTTPS, MX, TXT, …)
  - by **client**: one color per local source IP, with a live legend of the active devices
- **Settings page** to make it yours:
  - 5 theme presets, custom accent color, panel opacity, blur and side
  - 4 basemaps (dark, light, voyager, low-detail demo tiles)
  - arc width, glow, lifetime, curvature, animation style (comet / fade), max simultaneous arcs
  - destination labels, arrival pulse, `.local` filtering, per-browser location override
- **Sign-in** with optional **two-factor authentication** (TOTP + one-time recovery codes), managed from Settings
- Top queried domains, top blocked domains and top clients (from AdGuard Home stats), plus a live query log
- Hardened by default: strict CSP, no third-party scripts, rate-limited login, non-root read-only container

## How it works

```
AdGuard Home ──(query log API, polled)──▶ Atlas server ──(WebSocket)──▶ your browser
                                              │
                                  GeoIP lookup of answer IPs
                                  (cached, rate-limited)
```

The server only polls AdGuard Home while at least one browser is connected. Queries without a public answer IP
(blocked queries, local names, NXDOMAIN) are counted in the stats and the log but do not draw an arc.

## Quick start (Docker)

You need a running AdGuard Home and Docker with the Compose plugin.

```bash
git clone <this-repo> adguard-atlas && cd adguard-atlas
cp .env.example .env
# edit .env: ADGUARD_URL / ADGUARD_USERNAME / ADGUARD_PASSWORD,
#            SOURCE_LAT / SOURCE_LNG, DASHBOARD_PASSWORD, SESSION_SECRET
docker compose up --build -d
```

Open <http://localhost:8080> and sign in with `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.
If `DASHBOARD_PASSWORD` is empty, a random one is generated and printed in the logs (`docker compose logs adguard-atlas`).

> **AdGuard Home on the same machine?** Inside a container `localhost` is the container itself. Use
> `ADGUARD_URL=http://host.docker.internal:3000` (already mapped in `docker-compose.yml`) or the machine's LAN IP.

### Without Docker

Requires Node.js 22 or newer.

```bash
npm install
cp .env.example .env     # then edit it
npm start
```

## Configuration

All configuration is done through environment variables (a `.env` file is loaded automatically). Defaults below
are the values in `.env.example`.

| Variable | Default | Description |
| --- | --- | --- |
| `ADGUARD_URL` | `http://host.docker.internal:3000` | Base URL of AdGuard Home |
| `ADGUARD_USERNAME` / `ADGUARD_PASSWORD` | | AdGuard Home credentials (HTTP basic auth) |
| `DASHBOARD_USER` | `admin` | Username for the Atlas login |
| `DASHBOARD_PASSWORD` | random, printed in logs | Password for the Atlas login |
| `SESSION_SECRET` | random per start | Signs session cookies. Set it (`openssl rand -hex 32`) or everyone is signed out on restart |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS (adds `Secure` cookies and HSTS) |
| `TRUST_PROXY` | unset | Number of reverse-proxy hops (e.g. `1`) so rate limiting sees real client IPs |
| `SOURCE_LAT` / `SOURCE_LNG` | unset → `0,0` | **Your location**: where arcs start. A warning is logged if missing |
| `SOURCE_CITY` / `SOURCE_COUNTRY` | unset | Optional label for your location |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` in Docker, `./data` otherwise | Where 2FA configuration is stored |
| `POLL_INTERVAL_MS` | `3000` | How often the query log is polled |
| `STATS_INTERVAL_MS` | `5000` | How often stats are refreshed |
| `MAX_CONCURRENT_ARCS` | `100` | Server-side cap on simultaneous arcs |
| `MAX_WS_CONNECTIONS` | `50` | Maximum simultaneous browser connections |
| `GEOIP_*` | see `.env.example` | GeoIP endpoint, timeout, retries, cache size and rate limits |

Visual preferences (theme, arc style, location override, …) are stored **in your browser**, so each device can look different.
Two-factor authentication is stored **on the server** in the `DATA_DIR` volume.

## Two-factor authentication

1. Open **Settings → Two-factor authentication → Enable 2FA**.
2. Scan the QR code with an authenticator app (Google Authenticator, Aegis, 1Password, Bitwarden, …) and enter the 6-digit code.
3. **Save the 8 recovery codes** shown once. Each works a single time if you lose your device.

From then on, signing in asks for the password and then for a code (or a recovery code).
To disable it, use the same Settings section (password + code required).

**Lost both your authenticator and recovery codes?** Stop the container and delete the 2FA state:

```bash
docker compose down
docker run --rm -v adguard-atlas_atlas-data:/data alpine rm -f /data/atlas.json
docker compose up -d
```

(Check the exact volume name with `docker volume ls`; it is prefixed with your Compose project name.)

## Running behind a reverse proxy

Terminate TLS in front of Atlas and set `COOKIE_SECURE=true` and `TRUST_PROXY=1`. The proxy must forward
WebSocket upgrades on `/ws` **and preserve the `Host` header** (Atlas rejects WebSocket connections whose `Origin` does not match it).

Caddy:

```caddyfile
atlas.example.com {
    reverse_proxy adguard-atlas:8080
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## Security and privacy

**Access control**
- Everything except `/login/` and `/health` requires a session: `HttpOnly`, `SameSite=Strict` cookie, valid 12 hours.
- The WebSocket requires that cookie and a same-origin `Origin` header, which blocks cross-site WebSocket hijacking.
- Passwords are checked with scrypt and constant-time comparison. Login and 2FA endpoints allow 10 failed attempts per
  15 minutes per IP; a 2FA ticket allows 5 wrong codes. TOTP codes cannot be replayed, recovery codes are single-use and stored hashed.
- State-changing endpoints also verify the request origin.

**Hardening**
- Strict Content-Security-Policy: no inline scripts, no third-party scripts or fonts (the map library is served locally).
- The container runs as a non-root user with a read-only filesystem and all Linux capabilities dropped.
- The TOTP secret lives in `DATA_DIR/atlas.json` (mode `0600`). Protect that volume like a password file.

**What leaves your network**
- Destination IPs (never your clients' IPs) are sent to the GeoIP service, `ip-api.com` by default. Its free tier is
  **HTTP only**, so these lookups are unencrypted. Point `GEOIP_API_URL` at a different service if that matters to you.
- Your browser requests map tiles from CARTO (or MapLibre's demo tiles, depending on the basemap you pick).
- No telemetry, analytics or update checks.

**Limitations**
- Single-user. Sessions are stateless, so signing out clears the cookie but does not revoke already-issued tokens
  (they expire after 12 hours; changing `SESSION_SECRET` invalidates all of them at once).
- Expose it beyond your LAN only over HTTPS.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Status pill stays "Reconnecting" / red | `docker compose logs adguard-atlas`: usually wrong `ADGUARD_URL` or credentials (remember `localhost` ≠ the host inside Docker) |
| Map is blank, "WebGL2 is required" | Enable hardware acceleration or use another browser: the map library needs WebGL2 |
| Map loads but no arcs | Only queries with a public answer IP draw arcs. Also check the GeoIP rate limit in the logs (free tier: 15 requests/minute) |
| Arcs start in the wrong place | Set `SOURCE_LAT` / `SOURCE_LNG`, or override the location in Settings → Map |
| Signed out after every restart | Set a fixed `SESSION_SECRET` |
| Forgot the dashboard password | Set `DASHBOARD_PASSWORD` in `.env` and restart |

## Development

```bash
npm install
npm run dev     # restarts on file changes
npm test        # unit tests (vitest)
```

```
server/    Express + WebSocket server, AdGuard client, GeoIP service, auth, TOTP, security routes
public/    Dashboard (ES modules): map, arcs, sidebar, settings
login/     Public sign-in page (with the 2FA step)
tests/     Unit tests
```

## License

[MIT](LICENSE)
