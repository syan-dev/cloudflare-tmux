---
title: Single-user install
description: Run cloudflare-tmux and its tunnel as systemd user services under your own account.
---

# Single-user install

This is the default. The app and the tunnel run as **your** Linux user, as systemd **user** services, and
start at boot. Only Cloudflare accounts mapped to *your* username can open a terminal.

## With the installer

```bash
./install.sh --host term.example.com --identities you@example.com:$USER
```

## Step by step

The installer only runs these scripts in order. You can run them yourself:

```bash
# 1. Who may log in
mkdir -p -m 700 ~/.config/cloudflare-tmux
install -m 600 .env.example ~/.config/cloudflare-tmux/env
sed -i "s/^IDENTITIES=.*/IDENTITIES=you@example.com:$USER/" ~/.config/cloudflare-tmux/env

# 2. Cloudflare: tunnel, login method, Access application, DNS record
scripts/cloudflare.sh term.example.com

# 3. Services
scripts/setup.sh
```

`scripts/cloudflare.sh` asks for an [API token](../cloudflare/api-token.md) and writes `CF_TEAM_DOMAIN` and
`CF_ACCESS_AUD` to the config file.

`scripts/setup.sh`:

1. runs `npm ci --omit=dev`, which builds `node-pty`;
2. writes two units to `~/.config/systemd/user/`: `cloudflare-tmux.service` runs `node server.js` from this
   checkout, and `cloudflare-tmux-cloudflared.service` runs the tunnel with the saved token;
3. enables and restarts both;
4. turns on **lingering**, so the services run while you're logged out and start at boot.

> [!NOTE]
> If enabling linger fails, run `sudo loginctl enable-linger $USER` once. Without it, the services stop when
> you log out and don't start at boot.

## Where things live

| Path | What |
|---|---|
| `~/.config/cloudflare-tmux/env` | app config, mode `600` |
| `~/.cloudflared/cloudflare-tmux.token` | tunnel run token, mode `600` |
| `~/.config/systemd/user/cloudflare-tmux*.service` | the two units |

The units run the code **from this checkout**. After `git pull`, run `scripts/setup.sh` again. Your tmux
sessions survive the restart: the unit uses `KillMode=process`, so stopping the web server never stops the
tmux server it started.
