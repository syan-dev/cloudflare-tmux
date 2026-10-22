---
title: Troubleshooting
description: Fixes for common cloudflare-tmux problems - 401 errors, unmapped emails, tunnel down, node-pty build failures.
---

# Troubleshooting

Start with the logs. They almost always name the problem:

```bash
journalctl --user -u cloudflare-tmux -n 50 --no-pager
journalctl --user -u cloudflare-tmux-cloudflared -n 50 --no-pager
```

In the multi-user install, the first one is `sudo journalctl -u cloudflare-tmux -n 50 --no-pager`.

## Browser shows "Unauthorized" (401)

The app rejected the login. The log line `auth rejected ...: <reason>` says why:

| Reason in log | Fix |
|---|---|
| `missing Access token` | The request didn't come through Access. Check that the Access application covers exactly this hostname. |
| `email not mapped: x@y` | Add `x@y:user` to `IDENTITIES`, then re-run `cloudflare.sh` and `setup.sh`. |
| `unexpected "aud" claim value` | `CF_ACCESS_AUD` in the config file doesn't match the Access application. Re-run `scripts/cloudflare.sh <host>` and restart. |
| `unexpected "iss" claim value` | `CF_TEAM_DOMAIN` is wrong. Did you rename your team? Re-run `cloudflare.sh`. |
| `Linux user u does not exist` | Create the user, or fix the mapping. |
| `mapped to u, but the server runs as me` | The single-user install serves only your own user. Use `--multi-user`. |
| `has no login shell` | `sudo chsh -s /bin/bash u` |

## Cloudflare's "Access denied" page

Cloudflare Access blocked you before the request reached your server. The email you signed in with isn't in
the policy. Check **which** Cloudflare account you signed in with, then check `IDENTITIES` and re-run
`scripts/cloudflare.sh`.

## "Cloudflare sign-in is restricted to members of the account"

The Cloudflare account you signed in with isn't a member of your Cloudflare account yet.

- Invite it under **Manage Account → Members → Invite**, with the role **Minimal Account Access**.
- Make sure the invitation was **accepted**, from the email or from their own dashboard.

See [Cloudflare login](cloudflare/cloudflare-login.md).

## Two-step code is refused

- **"Wrong or already used code"**: the phone's clock is probably off. Turn on automatic time, then wait for
  a fresh code. Each code works only once.
- **"No authenticator set up for ..."**: enroll that email on the server with `scripts/totp.js add <email>`.
  Check the spelling matches `IDENTITIES`.
- **"Too many attempts"**: five wrong codes in five minutes. Wait a few minutes and try again.
- **Lost the phone**: run `scripts/totp.js add <email>` again to enroll a new device. The old one stops working.

See [Two-step code](two-step.md).

## Error 1033 / 502 / "Bad gateway"

- **1033**: the tunnel isn't connected. Check `systemctl --user status cloudflare-tmux-cloudflared` and the
  token file. If the service stops when you log out, enable linger: `sudo loginctl enable-linger $USER`.
- **502**: the tunnel works but nothing answers on `127.0.0.1:7681`. Check the app service, and that `PORT`
  matches the tunnel.

Test locally on the server:

```bash
curl -i http://127.0.0.1:7681/      # expect 401 Unauthorized: the app is up, it just wants a login
```

## App won't start: "Set CF_TEAM_DOMAIN, CF_ACCESS_AUD and IDENTITIES"

The config file is missing values. Run `scripts/cloudflare.sh <host>`, which fills in the first two. In the
multi-user install, the running config is `/etc/cloudflare-tmux/env`; re-run `install-system.sh` to refresh it.

## `npm ci` fails building node-pty

`node-pty` is a native module. Install the build tools, then retry:

```bash
sudo apt-get install -y build-essential python3     # Debian/Ubuntu
sudo dnf install -y gcc-c++ make python3            # Fedora/RHEL
```

## `cloudflare.sh`: "Zone example.com not found"

- The guessed zone is wrong: set `ZONE_NAME=yourzone.tld`.
- The token has no access to that zone: edit the token's **Zone Resources**.

## `cloudflare.sh`: "The 'Cloudflare' login method doesn't exist yet"

Your token has **Read** on *Access: Organizations, Identity Providers, and Groups*, which is enough except the
first time. Add the login method once in the dashboard, or give the token Edit for one run. See
[If the login method is missing](cloudflare/api-token.md#if-the-login-method-is-missing).

## `cloudflare.sh`: "API error ... Authentication error"

The token is missing a permission. Compare it with [API token](cloudflare/api-token.md#create-it). The failing
call, for example `GET /accounts/.../access/apps`, tells you which permission is missing.

## Terminal connects then immediately says "disconnected"

- A WebSocket blocked by a proxy or browser extension: try another network or a private window.
- The service can't find tmux. The unit's `PATH` comes from where `node` was found during `setup.sh`. Make
  sure `tmux` is in `/usr/bin`, `/usr/local/bin` or `/bin`.
- Multi-user: tmux must be at `/usr/bin/tmux` and `setpriv` at `/usr/bin/setpriv`, from util-linux.

## Keyboard shortcuts go to the browser instead of the terminal

Some shortcuts, such as `Ctrl-W`, `Ctrl-T` and `Ctrl-N`, are reserved by the browser. Install the site as an
app ("Install app" or "Add to Home screen") or use full-screen mode, where browsers pass more keys through.
In tmux, rebind anything you need to a key the browser leaves alone.

## Still stuck?

[Open an issue](https://github.com/syan-dev/cloudflare-tmux/issues/new/choose) with your OS, Node version,
the install mode (single or multi-user), and the relevant log lines. Remove emails and tokens before posting.
