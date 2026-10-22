---
title: Operations
description: Status, logs, updates, restarts, and complete uninstall of cloudflare-tmux.
---

# Operations

## Status and logs

In **single-user** mode both services are user services:


```bash
systemctl --user status cloudflare-tmux cloudflare-tmux-cloudflared
journalctl --user -u cloudflare-tmux -f          # logins, attach/detach, auth failures
journalctl --user -u cloudflare-tmux-cloudflared -f
```

For **multi-user** mode the app is a system service:

```bash
systemctl status cloudflare-tmux
journalctl -u cloudflare-tmux -f
systemctl --user status cloudflare-tmux-cloudflared   # the tunnel is still a user service
```

Typical log lines:

```text
cloudflare-tmux listening on http://127.0.0.1:7681 as root (multi-user); identities: alice@example.com→alice
attach alice/work by alice@example.com (pid 41233)
detach alice/work by alice@example.com (ws 1001)
auth rejected GET /: email not mapped: mallory@example.com
```

You can also see the tunnel's health in Zero Trust → **Networks → Tunnels** (it should say *Healthy*).

## Restarting

```bash
systemctl --user restart cloudflare-tmux    # single-user
sudo systemctl restart cloudflare-tmux      # multi-user
```

tmux sessions **survive** restarts, because the units use `KillMode=process`.

## Updating

```bash
cd cloudflare-tmux
git pull
scripts/setup.sh                                              # single-user
sudo NODE_BIN="$(command -v node)" scripts/install-system.sh  # multi-user, after setup.sh
```

Update `cloudflared` from time to time (the unit runs it with `--no-autoupdate`). Download a new binary
over the old one, or use your package manager, then `systemctl --user restart cloudflare-tmux-cloudflared`.

## Changing who can log in

Edit `IDENTITIES` in `.env`, then:

```bash
scripts/cloudflare.sh term.example.com   # updates the Access policy
scripts/setup.sh                         # or install-system.sh in multi-user mode
```

## Uninstall

1. Stop and remove the services:

   ```bash
   systemctl --user disable --now cloudflare-tmux cloudflare-tmux-cloudflared
   rm ~/.config/systemd/user/cloudflare-tmux.service ~/.config/systemd/user/cloudflare-tmux-cloudflared.service
   systemctl --user daemon-reload

   # multi-user only
   sudo systemctl disable --now cloudflare-tmux
   sudo rm -rf /etc/systemd/system/cloudflare-tmux.service /opt/cloudflare-tmux /etc/cloudflare-tmux
   sudo systemctl daemon-reload
   ```

2. Remove local secrets: `rm ~/.cloudflared/cloudflare-tmux.token ~/.cloudflare-token`, and
   `rm -r ~/.config/cloudflare-tmux` if you used the two-step code (`totp.json`).
3. In the Cloudflare dashboard:
   - **DNS** → delete the `term` CNAME record (do this first, so the hostname stops resolving),
   - **Zero Trust → Access → Applications** → delete `cloudflare-tmux`,
   - **Zero Trust → Networks → Tunnels** → delete `cloudflare-tmux`.
4. Your tmux sessions are untouched. End them with `tmux kill-server` if you want.
