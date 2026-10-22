---
title: Configuration
description: Every environment variable and file cloudflare-tmux and its scripts use.
---

# Configuration

## App config (`~/.config/cloudflare-tmux/env`)

The config lives outside the code, in `~/.config/cloudflare-tmux/env` (directory `700`, file `600`), so updating or
re-cloning the repo never touches it. The multi-user service reads `/etc/cloudflare-tmux/env` instead.
An older `.env` next to `server.js` still works, and the setup scripts move it to `~/.config/cloudflare-tmux/env`.
Real environment variables take priority over the file. `ENV_FILE=/path` points the app and the scripts
at a different file.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address. Keep it on loopback; the tunnel is the only way in. |
| `PORT` | `7681` | Listen port. Must match the tunnel ingress, so re-run `cloudflare.sh` with `PORT=...` to change it. |
| `CF_TEAM_DOMAIN` | — | `<team>.cloudflareaccess.com`. JWTs must be issued by this domain. Written by `cloudflare.sh`. |
| `CF_ACCESS_AUD` | — | The Access application's AUD tag. JWTs must carry this audience. Written by `cloudflare.sh`. |
| `IDENTITIES` | — | `email:linuxuser` pairs, comma-separated, using each person's Cloudflare account email. Emails are case-insensitive. Each email maps to one user; `root` is refused. |
| `TOTP` | `off` | `required` turns on the [two-step code](two-step.md): after Cloudflare login, the app asks for a 6-digit authenticator code. |
| `TOTP_SESSION_HOURS` | `12` | How long a verified code lasts before the app asks again (1–720). |
| `TOTP_FILE` | `~/.config/cloudflare-tmux/totp.json` (root: `/etc/cloudflare-tmux/totp.json`) | Enrolled authenticators and the cookie-signing key (mode `600`). Managed with `scripts/totp.js`. |
| `PUBLIC_HOST` | — | The public hostname. Saved by `cloudflare.sh`, so re-runs don't ask again. |
| `TUNNEL_NAME` | `cloudflare-tmux` | The Cloudflare tunnel to use. Saved by `cloudflare.sh`, so re-runs keep using the same tunnel. |
| `ACCESS_SESSION` | `24h` | How long a Cloudflare Access login lasts before people sign in again (`30m`, `8h`, ...). Applied to the Access app by `cloudflare.sh` (needs the [API token](cloudflare/api-token.md#when-you-need-it)); the app itself doesn't read it. |
| `AUTH_DISABLED` | unset | `1` turns off the Access check and acts as the current user. **Local development only**; refused when running as root. |

The app **won't start** unless `CF_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `IDENTITIES` are set (or `AUTH_DISABLED=1`).

Example:

```ini
HOST=127.0.0.1
PORT=7681
CF_TEAM_DOMAIN=myteam.cloudflareaccess.com
CF_ACCESS_AUD=4f6c0d3e...e91a
IDENTITIES=alice@example.com:alice,bob@example.com:bob
# TOTP=required
```

## Setup scripts

| Variable | Used by | Description |
|---|---|---|
| `CF_API_TOKEN` | `cloudflare.sh`, `install.sh` | API token for setup ([permissions](cloudflare/api-token.md)). If unset, the scripts ask for it. Never saved. Only set it for unattended runs. |
| `ZONE_NAME` | `cloudflare.sh` | Zone that holds the hostname. Defaults to the hostname minus its first label. |
| `TUNNEL_NAME` | `cloudflare.sh` | Tunnel name (default: the saved one, else `cloudflare-tmux`). Use a different name per machine if you install on several. |
| `PORT` | `cloudflare.sh` | Local port in the tunnel ingress and the config (default `7681`). |
| `ACCESS_SESSION` | `cloudflare.sh` | Access session duration (default: saved, else `24h`). |
| `ENV_FILE` | all | Config file to use instead of `~/.config/cloudflare-tmux/env`. |
| `NODE_BIN` | `install-system.sh` | Node binary to copy into `/opt/cloudflare-tmux` (default `command -v node`). |

## `install.sh` flags

| Flag | Description |
|---|---|
| `--host <hostname>` | hostname to serve on |
| `--identities <list>` | `email:user,...` |
| `--multi-user` | install the root system service (see [Multi-user](install/multi-user.md)) |
| `--yes`, `-y` | no prompts; fail if something required is missing |
| `--help` | usage |

## Files

| Path | Mode | Contents |
|---|---|---|
| `~/.config/cloudflare-tmux/env` | 600 (dir 700) | app config |
| `~/.cloudflared/cloudflare-tmux.token` | 600 | tunnel run token |
| `/opt/cloudflare-tmux/` | root, 755 | app copy (multi-user) |
| `/etc/cloudflare-tmux/env` | root, 600 | app config (multi-user) |
| `~/.config/cloudflare-tmux/totp.json` | 600 | two-step authenticators (only with `TOTP=required`; multi-user: `/etc/cloudflare-tmux/totp.json`) |

## Several machines, one domain

Run the installer on each machine with its own hostname **and** tunnel name:

```bash
TUNNEL_NAME=tmux-laptop ./install.sh --host laptop.example.com
TUNNEL_NAME=tmux-nas    ./install.sh --host nas.example.com
```

Each hostname gets its own Access application and AUD.
