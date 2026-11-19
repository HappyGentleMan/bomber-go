# BOMBER GO — hosting notes

Friends play at:

```
https://bomber.119-247-94-77.sslip.io
```

Public entry chain: sslip.io DNS (`*.119-247-94-77.sslip.io` → `119.247.94.77`) →
router forwards 80/443 → `192.168.0.241` → the **public** Caddy instance
(`~/.hermes/etc-from-vps/caddy/Caddyfile.public`, which imports `deploy/public.caddy`)
→ `~/srv/bomber-go/current` → the built game.

Backup entry (works even if the router/public IP breaks, but needs the URL shared
only with people who have Tailscale): `https://ansons-mac-studio.tail2102a2.ts.net:8443/bomber/`
— that one is a Tailscale Funnel path, i.e. still publicly reachable without
Tailscale, just ugly.

## What runs

| Piece | Where | What it does |
| --- | --- | --- |
| `deploy/public.caddy` | imported by `Caddyfile.public` | public site on `192.168.0.241:443` for `bomber.119-247-94-77.sslip.io` |
| `com.anson.bomber-go-web` | `~/Library/LaunchAgents/` | Caddy on `127.0.0.1:8414` (loopback copy + Tailscale Funnel target) |
| `com.anson.bomber-go-watch` | `~/Library/LaunchAgents/` | Watches `src/`, `public/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`; rebuilds + republishes ~1.5s after edits stop |
| Tailscale Funnel | `tailscale funnel status` | backup public entry on `:8443/bomber` |

Online play itself needs no server: the game uses PeerJS (public broker) with
host-authoritative netcode — the room creator's browser is the host.


## Deploying

Editing any game source file auto-deploys. To deploy by hand:

```sh
npm run deploy          # typecheck → build → atomic publish
```

`deploy/build.mjs` publishes into `~/srv/bomber-go/releases/<stamp>-<sha>/` and flips the
`~/srv/bomber-go/current` symlink, so Caddy never serves a half-written build. A failed
typecheck/build leaves the previous version live. The last 5 releases are kept.

## Version

Each release writes `~/srv/bomber-go/current/version.json`:

```json
{ "version": "0.1.0+20261119-194123.8a78903", "sha": "8a78903", "dirty": false, ... }
```

Pages that are already open poll it once a minute and show a "New version ready —
tap to reload" pill when it changes (never a forced reload, so nobody gets kicked
mid-match). `index.html`, `sw.js` and `version.json` are served `no-cache`; hashed
`/assets/*` are cached forever.

## Useful commands

```sh
tail -f deploy/logs/deploy.log                     # build/deploy history
launchctl kickstart -k gui/$UID/com.anson.bomber-go-web    # restart Caddy
launchctl kickstart -k gui/$UID/com.anson.bomber-go-watch  # restart watcher
tailscale funnel status                            # confirm public route
curl -sI https://ansons-mac-studio.tail2102a2.ts.net:8443/bomber/ | head
```

## Notes

- Funnel is public: anyone with the URL can open the game (and create/join
  rooms). Remove it with
  `tailscale funnel --https=8443 --set-path=/bomber off`.
- If the funnel route ever disappears (e.g. `tailscale funnel reset`), re-add it:

  ```sh
  tailscale funnel --bg --yes --https=8443 --set-path=/bomber http://127.0.0.1:8414
  ```

- The `/bomber` prefix keeps this isolated from the other apps already on
  `:8443` (`/` still goes to the IO sheet app).
- `~/srv/bomber-go/` (releases + `current`) and `deploy/logs/` are generated; don't edit them.
- The published copy deliberately lives outside `~/Documents`: the public Caddy
  runs as root, and macOS TCC blocks root from reading `~/Documents` (every
  request came back 403). Keep it in `~/srv`.
- Same-machine testing note: two tabs on the *same* machine may fail to connect
  over WebRTC (hairpin NAT / mDNS candidates). Test online play with a friend on
  another network.
