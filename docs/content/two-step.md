---
title: Two-step code
description: An optional 6-digit authenticator code that cloudflare-tmux itself checks after the Cloudflare login.
---

# Two-step code

With the two-step code on, getting past Cloudflare Access isn't enough. Before it lists sessions or opens a
terminal, the app asks for a 6-digit code from an authenticator app such as Google Authenticator, 1Password or
Authy. The check runs on your server, so it keeps protecting you if a Cloudflare account or the Access policy
is ever compromised.

> [!NOTE]
> This is separate from two-factor authentication on Cloudflare accounts, which each person should turn on
> anyway. See [Protect the accounts](cloudflare/cloudflare-login.md#protect-the-accounts).

## Turn it on

Enroll everyone **before** turning it on. Once it's on, anyone in `IDENTITIES` without an enrolled
authenticator is refused.

1. **Enroll each person on the server**, as the user the service runs as:

   ```bash
   scripts/totp.js add you@example.com
   ```

   It shows a QR code and the secret key. Scan or type it into the authenticator app, then enter a code to
   confirm. Nothing is saved until a code matches. The QR code needs `qrencode`; install it with
   `apt install qrencode`.

2. **Add `TOTP=required`** to `~/.config/cloudflare-tmux/env`.

3. **Restart the app.** Your tmux sessions aren't affected.

   ```bash
   cloudflare-tmux restart
   ```

> [!NOTE]
> **Multi-user install:** the service runs as root, so enroll with
> `sudo /opt/cloudflare-tmux/bin/node /opt/cloudflare-tmux/scripts/totp.js add you@example.com`.
> Replace the restart with `sudo NODE_BIN="$(command -v node)" scripts/install-system.sh`, which copies the
> config to `/etc/cloudflare-tmux/env`.

## Enroll, remove, list

| Command | Effect |
|---|---|
| `scripts/totp.js add <email>` | enroll, or re-enroll after losing a phone; the old device stops working |
| `scripts/totp.js remove <email>` | remove; that person can't get in until enrolled again |
| `scripts/totp.js list` | who is enrolled, and since when |

Changes apply immediately, without a restart.

## Settings

| Variable | Default | Description |
|---|---|---|
| `TOTP` | `off` | `required` turns the code on |
| `TOTP_SESSION_HOURS` | `12` | how long a verified code lasts before the app asks again, 1 to 720 |
| `TOTP_FILE` | `~/.config/cloudflare-tmux/totp.json` | enrolled authenticators and the cookie-signing key, mode `600`; multi-user: `/etc/cloudflare-tmux/totp.json` |

## How it's protected

- **Enrollment only on the server.** Nobody can enroll from the browser, so getting past Access doesn't let
  someone add their own device.
- **Fails closed.** No enrolled authenticator means no access.
- **No reuse, slow guessing.** Each code works once. Five wrong codes in five minutes lock that email out for
  a few minutes.
- **Signed cookie.** A verified code sets the `ct_2fa` cookie: `HttpOnly`, `SameSite=Strict`, `Secure`, signed
  and bound to the email and its secret. Re-enrolling or removing someone invalidates it at once.
- **Everything is gated.** The session list, session actions and terminal WebSockets all require it.

> [!TIP]
> If a code is refused, check the time on the phone first. Authenticator codes depend on an accurate clock.
> See [Troubleshooting](troubleshooting.md#two-step-code-is-refused).
