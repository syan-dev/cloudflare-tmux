---
title: Single-user install
description: Run cloudflare-tmux and its tunnel as systemd user services under your own account.
---

# Single-user install

This is the default mode. The app and the tunnel run as **your** Linux user, as systemd **user** services,
and start at boot. Only Cloudflare accounts mapped to *your* username can open a terminal.

## With the installer

```bash
./install.sh --host term.example.com --identities you@example.com:$USER
```

## Step by step

The installer only runs these scripts in order, so you can also run them yourself:

```bash
# 1. who may log in
mkdir -p -m 700 ~/.config/cloudflare-tmux
install -m 600 .env.example ~/.config/cloudflare-tmux/env
sed -i "s/^IDENTITIES=.*/IDENTITIES=you@example.com:$USER/" ~/.config/cloudflare-tmux/env

# 2. Cloudflare: tunnel, Cloudflare login, Access app, DNS (writes CF_TEAM_DOMAIN / CF_ACCESS_AUD to the config)
scripts/cloudflare.sh term.example.com

# 3. services
scripts/setup.sh
```

`scripts/setup.sh`:

1. runs `npm ci --omit=dev` (this builds `node-pty`),
2. writes two units to `~/.config/systemd/user/`:
   - `cloudflare-tmux.service`: `node server.js` in this directory,
   - `cloudflare-tmux-cloudflared.service`: `cloudflared tunnel run --token-file ~/.cloudflared/cloudflare-tmux.token`,
3. enables and restarts both,
4. turns on **lingering** (`loginctl enable-linger`) so user services run without you being logged in and start at boot.

> [!NOTE]
> If enabling linger fails, run `sudo loginctl enable-linger $USER` once. Without it, the services stop when
> you log out and don't start at boot.

## Where things live

| Path | What |
|---|---|
| `~/.config/cloudflare-tmux/env` | app config (`600`) |
| `~/.cloudflared/cloudflare-tmux.token` | tunnel run token (`600`) |
| `~/.config/systemd/user/cloudflare-tmux*.service` | units |

The units run the code **from this checkout**. After `git pull`, run `scripts/setup.sh` again to restart.
Your tmux sessions survive the restart because the unit uses `KillMode=process`, so stopping the web server
never kills the tmux server it started.
