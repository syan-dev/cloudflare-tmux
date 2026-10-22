---
title: Configuration
description: Every environment variable and file cloudflare-tmux and its scripts use.
---

# Configuration

## App (`.env`)

The app reads `.env` from its own directory, or `/etc/cloudflare-tmux/env` in multi-user mode. Real
environment variables take priority over the file.

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
| `CF_API_TOKEN` | `cloudflare.sh`, `install.sh` | API token. If unset, read from `~/.cloudflare-token`. |
| `ZONE_NAME` | `cloudflare.sh` | Zone that holds the hostname. Defaults to the hostname minus its first label. |
| `TUNNEL_NAME` | `cloudflare.sh` | Tunnel name (default `cloudflare-tmux`). Use a different name per machine if you install on several. |
| `PORT` | `cloudflare.sh` | Local port in the tunnel ingress and `.env` (default `7681`). |
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
| `.env` | 600 | app config |
| `~/.cloudflare-token` | 600 | API token (setup only) |
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
