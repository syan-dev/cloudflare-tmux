---
title: Configuration
description: Every environment variable, flag and file cloudflare-tmux and its scripts use.
---

# Configuration

## The config file

- The app reads `~/.config/cloudflare-tmux/env`. The directory is mode `700` and the file `600`.
- It lives outside the code, so updating or re-cloning the repo never touches it.
- The multi-user service reads `/etc/cloudflare-tmux/env` instead. `install-system.sh` copies it there.
- Real environment variables take priority over the file.
- `ENV_FILE=/path` points the app and the scripts at a different file.
- An older `.env` next to `server.js` still works. The setup scripts move it to the new location.

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Listen address. Keep it on loopback. The tunnel is the only way in. |
| `PORT` | `7681` | Listen port. Must match the tunnel. To change it, re-run `cloudflare.sh` with `PORT=...`. |
| `CF_TEAM_DOMAIN` | — | `<team>.cloudflareaccess.com`. Logins must come from this team. Written by `cloudflare.sh`. |
| `CF_ACCESS_AUD` | — | The Access application's AUD tag. Logins must be for this application. Written by `cloudflare.sh`. |
| `IDENTITIES` | — | Who may log in: `email:linuxuser` pairs, comma-separated. Emails are case-insensitive. `root` is refused. |
| `TOTP` | `off` | `required` turns on the [two-step code](two-step.md). |
| `TOTP_SESSION_HOURS` | `12` | How long a verified code lasts before the app asks again, 1 to 720. |
| `TOTP_FILE` | `~/.config/cloudflare-tmux/totp.json` | Enrolled authenticators and the cookie-signing key, mode `600`. Multi-user: `/etc/cloudflare-tmux/totp.json`. |
| `PUBLIC_HOST` | — | The public hostname. Saved by `cloudflare.sh`, so re-runs don't ask again. |
| `TUNNEL_NAME` | `cloudflare-tmux` | The tunnel to use. Saved by `cloudflare.sh`, so re-runs keep the same tunnel. |
| `ACCESS_SESSION` | `24h` | How long a Cloudflare login lasts, for example `8h`. Applied by `cloudflare.sh`, which needs an [API token](cloudflare/api-token.md#when-you-need-it). |
| `AUTH_DISABLED` | unset | `1` skips the login check and acts as the current user. **Local development only.** Refused as root. |

The app won't start unless `CF_TEAM_DOMAIN`, `CF_ACCESS_AUD` and `IDENTITIES` are set, or `AUTH_DISABLED=1`.

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
| `CF_API_TOKEN` | `cloudflare.sh`, `install.sh` | The [API token](cloudflare/api-token.md). If unset, the scripts ask for it. Never saved. Set it only for unattended runs. |
| `ZONE_NAME` | `cloudflare.sh` | Zone that holds the hostname. Defaults to the hostname minus its first label. |
| `TUNNEL_NAME` | `cloudflare.sh` | Tunnel name. Defaults to the saved one, else `cloudflare-tmux`. Use a different name per machine. |
| `PORT` | `cloudflare.sh` | Local port for the tunnel and the config. Default `7681`. |
| `ACCESS_SESSION` | `cloudflare.sh` | How long a Cloudflare login lasts. Defaults to the saved value, else `24h`. |
| `ENV_FILE` | all | Config file to use instead of `~/.config/cloudflare-tmux/env`. |
| `NODE_BIN` | `install-system.sh` | Node binary to copy into `/opt/cloudflare-tmux`. Defaults to `command -v node`. |

## `install.sh` flags

| Flag | Description |
|---|---|
| `--host <hostname>` | hostname to serve on |
| `--identities <list>` | `email:user,...` |
| `--multi-user` | install the root system service. See [Multi-user install](install/multi-user.md). |
| `--yes`, `-y` | no prompts; fail if something required is missing |
| `--help` | usage |

## Files

| Path | Mode | Contents |
|---|---|---|
| `~/.config/cloudflare-tmux/env` | 600, dir 700 | app config |
| `~/.cloudflared/cloudflare-tmux.token` | 600 | tunnel run token |
| `~/.config/cloudflare-tmux/totp.json` | 600 | two-step authenticators, only with `TOTP=required` |
| `/opt/cloudflare-tmux/` | root, 755 | app copy, multi-user |
| `/etc/cloudflare-tmux/env` | root, 600 | app config, multi-user |
| `/etc/cloudflare-tmux/totp.json` | root, 600 | two-step authenticators, multi-user |

## Several machines, one domain

Run the installer on each machine with its own hostname **and** tunnel name:

```bash
TUNNEL_NAME=tmux-laptop ./install.sh --host laptop.example.com
TUNNEL_NAME=tmux-nas    ./install.sh --host nas.example.com
```

Each hostname gets its own Access application.
