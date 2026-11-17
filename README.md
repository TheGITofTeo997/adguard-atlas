# AdGuard Atlas

Real-time visualization of your AdGuard Home DNS queries on a world map: animated arcs connect your
location to the servers your devices talk to.

## Features

- Live arcs from your location to every resolved destination, with domain labels and arrival pulses
- **Two arc color modes** (toggle in the sidebar or Settings): by **DNS record type**, or by **client** (one color per
  local source IP, with a live legend of the active clients)
- **Settings page**: 5 theme presets, custom accent, panel opacity/blur and side, 4 basemaps, globe projection,
  arc width/glow/lifetime/curvature/animation, max arcs, labels, location override
- Login with optional **two-factor authentication** (TOTP + recovery codes), configurable from Settings
- Top domains / blocked / clients from AdGuard Home stats, live query log

## Quick start (Docker)

```bash
cp .env.example .env      # set ADGUARD_*, SOURCE_LAT/LNG, DASHBOARD_PASSWORD, SESSION_SECRET
docker compose up --build
```

Open http://localhost:8080 and sign in with `DASHBOARD_USER` / `DASHBOARD_PASSWORD`.
If `DASHBOARD_PASSWORD` is empty, a random one is printed in the container logs.

Without Docker (Node 22+): `npm install && node --env-file=.env server/index.js`.

## Configuration

See `.env.example`. The two things you almost certainly want to set:

- `SOURCE_LAT` / `SOURCE_LNG`: where the arcs start. If unset, `0,0` is used (and a warning is logged).
  You can also override it per browser in Settings → Map.
- `DASHBOARD_PASSWORD` and `SESSION_SECRET` (`openssl rand -hex 32`).

Visual settings are stored in your browser (localStorage). 2FA is stored on the server in the `/data` volume.

## Security model

- Everything except `/login/` and `/health` requires a session (HttpOnly, SameSite=Strict cookie, 12 h).
- The WebSocket (`/ws`) requires the session cookie and a same-origin `Origin` header.
- Password: scrypt + constant-time comparison. Login and 2FA endpoints are limited to 10 failed attempts / 15 min / IP;
  a 2FA ticket allows at most 5 wrong codes. TOTP codes cannot be replayed; recovery codes are single-use and stored hashed.
- The 2FA secret is stored in `/data/atlas.json` (file mode 0600). Protect the volume like you would a password file.
- Strict CSP: no third-party scripts or fonts (MapLibre is served locally). Third-party requests are limited to
  basemap tiles (CARTO / MapLibre demo tiles) and the GeoIP API.
- GeoIP uses ip-api.com over plain HTTP by default: destination IPs (not client IPs) are sent unencrypted.
- Container runs as non-root, read-only root filesystem, all capabilities dropped.
- Serve it over HTTPS (reverse proxy) and set `COOKIE_SECURE=true` if you expose it beyond your LAN.
- If you lose both your authenticator and recovery codes: stop the container and delete the `twofa` entry from
  `/data/atlas.json` (or remove the volume).

## Tests

`npm test` (vitest).

## License

MIT, see [LICENSE](LICENSE).
