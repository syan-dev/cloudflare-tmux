---
title: Maintenance
description: The cloudflare-tmux command, updates, logs, and a complete uninstall.
---

# Maintenance

## The cloudflare-tmux command

The installer links `bin/cloudflare-tmux` into `~/.local/bin`. It is the one command for day-to-day work.

```bash
cloudflare-tmux status                 # is it online? app, tunnel, public URL, how many people
cloudflare-tmux people                 # each person: Linux user, live in the app or not, last login
cloudflare-tmux add carol@example.com carol
cloudflare-tmux remove carol@example.com
cloudflare-tmux config                 # the configuration and where things live
cloudflare-tmux logs -f                # the app log, whichever install you have
cloudflare-tmux restart                # restart the app the right way for this install
cloudflare-tmux doctor                 # check everything and print the fix for anything wrong
```

Output is colored on a terminal. Set `NO_COLOR=1` or pipe it to turn colors off.

If the command isn't found, `~/.local/bin` isn't on your `PATH` yet. Log out and in, or run
`export PATH="$HOME/.local/bin:$PATH"`. From the checkout, `./install.sh add|remove|list|doctor` does the same.

## Logs

`cloudflare-tmux logs` shows the app log. Typical lines:

```text
cloudflare-tmux listening on http://127.0.0.1:7681 as alice; identities: alice@example.com→alice
attach alice/work by alice@example.com (pid 41233)
detach alice/work by alice@example.com (ws 1001)
auth rejected GET /: email not mapped: mallory@example.com
```

The tunnel has its own log: `journalctl --user -u cloudflare-tmux-cloudflared -f`. Its health also shows under
**Zero Trust → Networks → Tunnels** in the dashboard. It should say *Healthy*.

Cloudflare keeps a login log too, under **Zero Trust → Logs → Access**, with email and IP for every login.

## Restarts and reboots

Both services start at boot and need no login. `cloudflare-tmux restart` restarts the app. tmux sessions
survive restarts of the app, but not a reboot of the machine.

## Update the app

```bash
cd cloudflare-tmux
git pull
cloudflare-tmux restart
```

In the single-user install, run `scripts/setup.sh` instead of the restart the first time after a pull, so new
dependencies are installed. No API token is needed either way.

## Update cloudflared

The tunnel runs `cloudflared` with `--no-autoupdate`, so update it yourself, for example monthly or when
Cloudflare announces a security fix:

```bash
scripts/install-cloudflared.sh --restart
```

It downloads the latest release, checks its SHA-256 against GitHub and Cloudflare's release notes, and restarts
the tunnel only if the binary changed. If your `cloudflared` comes from a package manager, update it there
instead and run `systemctl --user restart cloudflare-tmux-cloudflared`.

## Uninstall

1. Stop and remove the services:

   ```bash
   systemctl --user disable --now cloudflare-tmux cloudflare-tmux-cloudflared
   rm ~/.config/systemd/user/cloudflare-tmux.service ~/.config/systemd/user/cloudflare-tmux-cloudflared.service
   systemctl --user daemon-reload
   ```

   Multi-user install, also:

   ```bash
   sudo systemctl disable --now cloudflare-tmux
   sudo rm -rf /etc/systemd/system/cloudflare-tmux.service /opt/cloudflare-tmux /etc/cloudflare-tmux
   sudo systemctl daemon-reload
   ```

2. Remove the local secrets and the command:

   ```bash
   rm -f ~/.cloudflared/cloudflare-tmux.token ~/.local/bin/cloudflare-tmux
   rm -r ~/.config/cloudflare-tmux        # config and two-step authenticators
   ```

3. In the Cloudflare dashboard, in this order:
   - **DNS**: delete the `term` CNAME record, so the hostname stops resolving.
   - **Zero Trust → Access → Applications**: delete `cloudflare-tmux`.
   - **Zero Trust → Networks → Tunnels**: delete the tunnel.

4. Your tmux sessions are untouched. End them with `tmux kill-server` if you want.
