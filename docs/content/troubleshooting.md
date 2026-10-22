---
title: Troubleshooting
description: Fixes for common cloudflare-tmux problems - 401 errors, unmapped emails, tunnel down, node-pty build failures.
---

# Troubleshooting

Start with the logs. They almost always name the problem:

```bash
journalctl --user -u cloudflare-tmux -n 50 --no-pager     # multi-user: journalctl -u cloudflare-tmux
journalctl --user -u cloudflare-tmux-cloudflared -n 50 --no-pager
```

## Browser shows "Unauthorized" (401)

The app rejected the Access JWT. The log line `auth rejected ...: <reason>` tells you why:

| Reason in log | Fix |
|---|---|
| `missing Access token` | The request didn't come through Access. Check that the Access application covers exactly this hostname. |
| `email not mapped: x@y` | Add `x@y:user` to `IDENTITIES`, then re-run `cloudflare.sh` and `setup.sh` / `install-system.sh`. |
| `unexpected "aud" claim value` | `CF_ACCESS_AUD` in `~/.config/cloudflare-tmux/env` doesn't match the app. Re-run `scripts/cloudflare.sh <host>` and restart. |
| `unexpected "iss" claim value` | `CF_TEAM_DOMAIN` is wrong (did you rename your team?). Re-run `cloudflare.sh`. |
| `Linux user u does not exist` | Create the user, or fix the mapping. |
| `mapped to u, but the server runs as me` | Single-user mode can only serve your own user. Use `--multi-user`. |
| `has no login shell` | `sudo chsh -s /bin/bash u` |

## Cloudflare's "Access denied" page

Cloudflare Access blocked you before the request reached your server. The email you signed in with isn't in
the policy. Check **which** Cloudflare account you signed in with, then check `IDENTITIES` and re-run
`scripts/cloudflare.sh`.

## "Cloudflare sign-in is restricted to members of the account"

The Cloudflare account you signed in with isn't a member of your Cloudflare account yet:

- invite it under **Manage Account → Members → Invite** (role **Minimal Account Access**), and
- make sure the invitation was **accepted**: the person opens the email, or the invite in their own dashboard.

See [Cloudflare login](cloudflare/cloudflare-login.md).

## Two-step code is refused

- **"Wrong or already used code"**: the phone's clock is probably off. Turn on automatic time, then wait for
  a fresh code. Each code works only once.
- **"No authenticator set up for ..."**: enroll that email on the server: `scripts/totp.js add <email>`.
  Check the spelling matches `IDENTITIES`.
- **"Too many attempts"**: 5 wrong codes in 5 minutes. Wait a few minutes and try again.
- Lost the phone: run `scripts/totp.js add <email>` again to enroll a new device. The old one stops working.

See [Two-step login](two-step.md).

## Error 1033 / 502 / "Bad gateway"

- **1033**: the tunnel isn't connected. Check `systemctl --user status cloudflare-tmux-cloudflared` and the token file.
  If the service stops when you log out, enable linger: `sudo loginctl enable-linger $USER`.
- **502**: the tunnel works but nothing answers on `127.0.0.1:7681`. Check the app service, and that `PORT` matches the tunnel ingress.

Test locally on the server:

```bash
curl -i http://127.0.0.1:7681/      # expect 401 Unauthorized (no Access token) = app is up
```

## App won't start: "Set CF_TEAM_DOMAIN, CF_ACCESS_AUD and IDENTITIES"

`~/.config/cloudflare-tmux/env` is missing values. Run `scripts/cloudflare.sh <host>`, which fills in the first two. In multi-user mode,
the running config is `/etc/cloudflare-tmux/env`; re-run `install-system.sh` to refresh it.

## `npm ci` fails building node-pty

`node-pty` is a native module. Install the build tools, then retry:

```bash
sudo apt-get install -y build-essential python3     # Debian/Ubuntu
sudo dnf install -y gcc-c++ make python3            # Fedora/RHEL
```

## `cloudflare.sh`: "Zone example.com not found"

- The guessed zone is wrong: set `ZONE_NAME=yourzone.tld`.
- The token has no access to that zone: edit the token's **Zone Resources**.

## `cloudflare.sh`: "API error ... Authentication error"

The token is missing a permission. Compare it with [API token](cloudflare/api-token.md). The failing call
(for example `GET /accounts/.../access/apps`) tells you which permission is missing.

## Terminal connects then immediately says "disconnected"

- A WebSocket blocked by a proxy or browser extension: try another network or a private window.
- The tmux binary isn't found by the service: the unit's `PATH` comes from where `node` was found during
  `setup.sh`. Make sure `tmux` is in `/usr/bin`, `/usr/local/bin` or `/bin`.
- Multi-user: tmux must be at `/usr/bin/tmux` and `setpriv` at `/usr/bin/setpriv` (util-linux).

## Keyboard shortcuts go to the browser instead of the terminal

Some shortcuts (`Ctrl-W`, `Ctrl-T`, `Ctrl-N`) are reserved by the browser. Install the site as an app
("Install app" / "Add to Home screen") or use full-screen mode, where browsers pass more keys through.
In tmux, rebind anything you need to a key the browser leaves alone.

## Still stuck?

[Open an issue](https://github.com/syan-dev/cloudflare-tmux/issues/new/choose) with your OS, Node version,
the mode (single or multi-user), and the relevant log lines. Remove emails and tokens before posting.
