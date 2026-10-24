---
title: Operations
description: Status, logs, restarts, updates, and a complete uninstall.
---

# Operations

The commands below are for the single-user install. The [multi-user](#multi-user-install) section at the end
lists what differs.

## Status and logs

```bash
systemctl --user status cloudflare-tmux cloudflare-tmux-cloudflared
journalctl --user -u cloudflare-tmux -f               # logins, attach/detach, refusals
journalctl --user -u cloudflare-tmux-cloudflared -f   # the tunnel
```

Typical log lines:

```text
cloudflare-tmux listening on http://127.0.0.1:7681 as alice; identities: alice@example.com→alice
attach alice/work by alice@example.com (pid 41233)
detach alice/work by alice@example.com (ws 1001)
auth rejected GET /: email not mapped: mallory@example.com
```

The tunnel's health also shows under **Zero Trust → Networks → Tunnels**. It should say *Healthy*.

## Restart

```bash
systemctl --user restart cloudflare-tmux
```

tmux sessions survive restarts. The unit uses `KillMode=process`, so stopping the app never stops the tmux
server.

## Update the app

```bash
cd cloudflare-tmux
git pull
scripts/setup.sh
```

No API token needed.

## Update cloudflared

The tunnel runs `cloudflared` with `--no-autoupdate`, so update it yourself, for example monthly or when
Cloudflare announces a security fix:

```bash
scripts/install-cloudflared.sh --restart
```

It downloads the latest release to `~/.local/bin/cloudflared`, checks its SHA-256 against GitHub and
Cloudflare's release notes, and restarts the tunnel only if the binary changed. No API token needed.

If your `cloudflared` comes from a package manager, update it there instead and run
`systemctl --user restart cloudflare-tmux-cloudflared`.

## Add or remove a person

```bash
scripts/people.sh add carol@example.com carol     # asks for a short-lived API token
scripts/people.sh remove carol@example.com        # no token needed
scripts/people.sh list
```

See [Cloudflare login](cloudflare/cloudflare-login.md) for inviting them as a member first.

## Uninstall

1. Stop and remove the services:

   ```bash
   systemctl --user disable --now cloudflare-tmux cloudflare-tmux-cloudflared
   rm ~/.config/systemd/user/cloudflare-tmux.service ~/.config/systemd/user/cloudflare-tmux-cloudflared.service
   systemctl --user daemon-reload
   ```

2. Remove the local secrets:

   ```bash
   rm -f ~/.cloudflared/cloudflare-tmux.token
   rm -r ~/.config/cloudflare-tmux        # config and two-step authenticators
   ```

3. In the Cloudflare dashboard, in this order:
   - **DNS**: delete the `term` CNAME record, so the hostname stops resolving.
   - **Zero Trust → Access → Applications**: delete `cloudflare-tmux`.
   - **Zero Trust → Networks → Tunnels**: delete `cloudflare-tmux`.

4. Your tmux sessions are untouched. End them with `tmux kill-server` if you want.

## Multi-user install

The app is a system service running as root. The tunnel is still a user service.

```bash
sudo systemctl status cloudflare-tmux
sudo journalctl -u cloudflare-tmux -f
sudo systemctl restart cloudflare-tmux
```

After `git pull`, run both of these. After changing only the config file, the second is enough:

```bash
scripts/setup.sh
sudo NODE_BIN="$(command -v node)" scripts/install-system.sh
```

To uninstall, also run:

```bash
sudo systemctl disable --now cloudflare-tmux
sudo rm -rf /etc/systemd/system/cloudflare-tmux.service /opt/cloudflare-tmux /etc/cloudflare-tmux
sudo systemctl daemon-reload
```
