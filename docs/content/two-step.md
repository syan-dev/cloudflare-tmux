---
title: Two-step login
description: Add a second step to logging in - 2FA on Cloudflare accounts, plus an optional authenticator code checked by cloudflare-tmux itself.
---

# Two-step login

There are two layers. Use the first one always; add the second if you want a check that you control on
the server.

| Layer | Who checks it | Setup |
|---|---|---|
| **2FA on each Cloudflare account** (recommended) | Cloudflare, when the person signs in | each person, in their Cloudflare profile |
| **Authenticator code in the app** (optional) | cloudflare-tmux, after Cloudflare login | `TOTP=required` and `scripts/totp.js` on the server |

## 1. Two-factor authentication on Cloudflare accounts

Each person turns on two-factor authentication in their Cloudflare profile (**My Profile → Authentication**),
with an authenticator app or a security key. As the account owner, you can require it for every member:
look for the option to **enforce two-factor authentication for members** in your account's member settings.
See [Cloudflare login](cloudflare/cloudflare-login.md).

## 2. Authenticator code in the app

With this on, getting past Cloudflare Access isn't enough. Before it lists sessions or opens a terminal,
cloudflare-tmux asks for a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy,
and so on). It works with any Cloudflare plan and keeps protecting you if the Access policy is ever
misconfigured.

### Turn it on

1. Enroll each person **on the server** (as the user the service runs as):

   ```bash
   scripts/totp.js add you@example.com
   ```

   It shows a QR code (if `qrencode` is installed: `apt install qrencode`) and the secret key. Add it to
   the authenticator app, then type a code to confirm. Nothing is saved until a code matches.

   Multi-user install (the service runs as root):

   ```bash
   sudo /opt/cloudflare-tmux/bin/node /opt/cloudflare-tmux/scripts/totp.js add you@example.com
   ```

2. Add `TOTP=required` to `~/.config/cloudflare-tmux/env` (multi-user: re-run `install-system.sh`, which copies it to
   `/etc/cloudflare-tmux/env`), then restart the app:

   ```bash
   systemctl --user restart cloudflare-tmux      # multi-user: sudo systemctl restart cloudflare-tmux
   ```

   Restarting the app doesn't touch your tmux sessions.

Enroll people **before** turning it on: anyone mapped in `IDENTITIES` without an enrolled authenticator is
refused (the page tells them to ask you).

### Managing people

| Command | Effect |
|---|---|
| `scripts/totp.js add <email>` | enroll, or re-enroll after losing a phone. The old device stops working. |
| `scripts/totp.js remove <email>` | remove; that person can't get in until enrolled again |
| `scripts/totp.js list` | who is enrolled, and when |

Changes apply immediately, without a restart.

### Settings

| Variable | Default | Description |
|---|---|---|
| `TOTP` | `off` | `required` turns the code on |
| `TOTP_SESSION_HOURS` | `12` | how long a verified code lasts before the app asks again (1–720) |
| `TOTP_FILE` | `~/.config/cloudflare-tmux/totp.json` (root: `/etc/cloudflare-tmux/totp.json`) | enrolled authenticators and the cookie-signing key, mode `600` |

### How it's protected

- **Enrollment only on the server.** There's no way to enroll from the browser, so someone who gets past
  Access can't add their own device.
- **Fails closed.** No enrolled authenticator means no access.
- **No reuse, slow guessing.** Each code works once, and 5 wrong codes in 5 minutes lock that email out for a few minutes.
- **Signed cookie.** A verified code sets `ct_2fa`: `HttpOnly`, `SameSite=Strict`, `Secure`, signed with
  HMAC and bound to the email and its secret. Re-enrolling or removing someone invalidates it at once.
- **Everything is gated.** The session list, session actions and terminal WebSockets all require it.

> [!TIP]
> If a code is refused, check the time on the phone first: authenticator codes depend on an accurate
> clock. See [Troubleshooting](troubleshooting.md).
