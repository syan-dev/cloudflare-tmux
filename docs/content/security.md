---
title: Security model
description: How cloudflare-tmux protects a shell exposed on a public URL - defense in depth from Cloudflare's edge to the PTY.
---

# Security model

A web terminal is a remote shell, so cloudflare-tmux is built on the assumption that any single layer can
fail. Every layer below would have to fail before a stranger got a shell.

## Layers

### 1. Nothing listens on the internet

The app binds to `127.0.0.1:7681`. `cloudflared` makes **outbound** connections to Cloudflare, so there's no
inbound port to scan, brute-force, or exploit, and your server's IP never appears in DNS.

### 2. Cloudflare Access in front

Every request to the hostname passes through Cloudflare Access first:

- **Cloudflare account login is the only login method**, restricted to members of your Cloudflare account.
  There are no one-time email codes and no other providers.
- An **Allow** policy includes exactly the emails in `IDENTITIES`. Nobody else gets past Cloudflare's edge.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and expires after `ACCESS_SESSION` (default 24h).

### 3. The app verifies the JWT again

Access adds a signed JWT to each request (the `Cf-Access-Jwt-Assertion` header / `CF_Authorization` cookie).
The app **doesn't trust Access blindly**. On every HTTP request **and** every WebSocket upgrade it:

- verifies the signature against your team's public keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`),
- checks the **issuer** is your team domain and the **audience** is this application's AUD tag,
- checks the email is in its own `IDENTITIES` list.

So a misconfigured Access policy (say, someone changes it to "everyone"), a different Access app on the same
team, or a request that reaches port 7681 locally still can't open a shell. The app **refuses to start** without this configuration.

### 4. Same-origin checks

WebSocket upgrades and every non-GET request must carry an `Origin` matching the host. This blocks
cross-site WebSocket hijacking and CSRF that would otherwise ride on your Access cookie. A missing or
malformed `Origin` (such as `null`) is refused.

### 5. Optional second step in the app

With `TOTP=required`, passing Access isn't enough: the app also asks for a 6-digit authenticator code
before it lists sessions or opens a terminal. Authenticators are enrolled only on the server, never in the
browser, a reused or wrong code is refused, and guessing is rate-limited. See [Two-step login](two-step.md).

### 6. Fixed identity → account mapping

- No Linux password is ever typed into a web page.
- The email → user mapping lives on the server, and users can't choose an account.
- `root` / UID 0 can never be mapped, and accounts with `nologin`/`false` shells are refused.
- In single-user mode, emails mapped to any user other than the one running the service are refused.

### 7. Privilege separation (multi-user)

- tmux runs through `setpriv --reuid --regid --init-groups --reset-env`, so each person's processes have their own uid, gid and groups, and a clean environment.
- The root service runs only **root-owned** code from `/opt/cloudflare-tmux`. No user can change what root executes.
- Its config (`/etc/cloudflare-tmux/env`) is readable only by root.

### 8. Hardened HTTP

`Content-Security-Policy: default-src 'self'`, `X-Frame-Options: DENY` (no clickjacking),
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`, small request-body limits, and validated
session names (`[A-Za-z0-9_-]{1,32}`) that are always passed as separate arguments, never through a shell.

## Hardening checklist

Work through this once after the [quickstart](quickstart.md), and again whenever you add someone. Each
step says whether it needs the Cloudflare API token. Most don't.

### 1. Cloudflare accounts (dashboard, no token)

Every allowed Cloudflare account is a key to a shell, so protect those accounts first.

- [ ] Turn on **two-factor authentication** on your own Cloudflare account (**My Profile → Authentication**),
  preferably with a security key or an authenticator app.
- [ ] **Require 2FA for all members** of your account (the option to enforce two-factor authentication in
  your account's member settings).
- [ ] Give everyone else **Minimal Account Access** only. An admin on your account can change the Access
  policy and the tunnel, which means they could let themselves in.
- [ ] Look at **Manage Account → Members** and remove anyone who shouldn't be there.

### 2. The API token (dashboard)

- [ ] Scope it to **one account** and **one zone**, with the [smallest permissions](cloudflare/api-token.md#permissions).
- [ ] Give it a **short expiry**, and optionally a **client IP filter** for your server.
- [ ] **Delete it** once setup works. Nothing running uses it.
- [ ] Don't keep a copy anywhere: the scripts ask for it when they need it and never save it.

### 3. Access application (needs the token, or the dashboard)

- [ ] **Shorten the login lifetime.** Set `ACCESS_SESSION=8h` (or less) in `~/.config/cloudflare-tmux/env` and
  re-run `scripts/cloudflare.sh` with a token. The default is `24h`. Make this change through the config
  rather than the dashboard, because `cloudflare.sh` overwrites the dashboard value on every run.
- [ ] Make sure the **Cloudflare** login method is restricted to account members. `cloudflare.sh` warns if it
  isn't.
- [ ] Optional: **device posture or country rules** (*Require* rules on the Access policy). Add them in the
  dashboard. `cloudflare.sh` replaces the policy on every run, so re-add them after a re-run, or stop
  re-running it.

### 4. The app (server, no token)

- [ ] Turn on the app's own **[two-step code](two-step.md)** (`TOTP=required`). It's checked on your
  server, so it still protects you if a Cloudflare account or the Access policy is compromised.
- [ ] Keep `TOTP_SESSION_HOURS` short, for example `8`.
- [ ] Map only people you'd give an SSH login to, and never a shared or admin account.
- [ ] Never set `AUTH_DISABLED=1` or a `HOST` other than `127.0.0.1` on a real install.

### 5. The server (no token)

- [ ] Check that only loopback is listening:

  ```bash
  ss -ltnp | grep 7681          # expect 127.0.0.1:7681, never 0.0.0.0 or *
  ```

- [ ] Check the secret files are private:

  ```bash
  ls -ld ~/.config/cloudflare-tmux ~/.cloudflared             # drwx------
  ls -l ~/.config/cloudflare-tmux/env ~/.cloudflared/*.token  # -rw-------
  ```

  If other people have accounts on the machine, make your home directory private too: `chmod 700 ~`.
- [ ] Check the hostname is protected from outside (on any machine):

  ```bash
  curl -sI https://term.example.com | grep -i '^location'     # expect ...cloudflareaccess.com/...
  ```

- [ ] Keep the OS, Node.js and tmux patched (for example with `unattended-upgrades` on Debian/Ubuntu).
- [ ] Update `cloudflared` regularly: `scripts/install-cloudflared.sh --restart`. It doesn't update itself.
  See [Operations](operations.md#updating-cloudflared).

### 6. Watch it (no token)

- [ ] **Zero Trust → Logs → Access** shows every Cloudflare login to the app, with the email and IP.
- [ ] The app logs every attach, detach and refusal:

  ```bash
  journalctl --user -u cloudflare-tmux | grep -E 'attach|rejected'   # multi-user: sudo journalctl -u cloudflare-tmux
  ```

  `auth rejected` and `2fa rejected` lines from people you don't expect are worth a look.

## If something goes wrong

If you think a person's Cloudflare account, a device or the API token is compromised, do these in order.
The first three need **no API token**, so you can act right away.

1. **Lock them out of the app.** Remove their entry from `IDENTITIES` and restart:
   `systemctl --user restart cloudflare-tmux` (multi-user: re-run `install-system.sh`). The app refuses them
   immediately, even with a valid Cloudflare login, and the restart drops any open terminal.
2. **End what they left running.** Their tmux sessions keep running after the lockout. Check them with
   `tmux ls` as that Linux user, and remove them with `tmux kill-server` (or `kill-session -t name`).
   Review `~/.ssh/authorized_keys`, crontabs and shell startup files for anything they added.
3. **Revoke at Cloudflare.** In the dashboard, revoke their Access sessions (**Zero Trust → Users →** the
   person **→ Revoke session**), remove or downgrade them under **Manage Account → Members**, and delete
   any API token that may have leaked.
4. **Remove them from the Access policy.** Run `scripts/cloudflare.sh` with a new short-lived
   [API token](cloudflare/api-token.md#when-you-need-it), then delete the token.
5. **If the tunnel token leaked** (`~/.cloudflared/cloudflare-tmux.token`): delete the tunnel in **Zero
   Trust → Networks → Tunnels**, then re-run `scripts/cloudflare.sh` and `scripts/setup.sh` with an API
   token. That creates a new tunnel with a new token. With the old token, someone could run their own
   connector for your hostname, though Access would still sit in front of it.
6. If you use the two-step code and a phone was lost: `scripts/totp.js remove their@email`, then
   `scripts/totp.js add` again on the new device.

## What it doesn't protect against

- A compromised Cloudflare member account on the allow-list: that person gets that user's shell. Use 2FA, and the app's two-step code.
- Other users on the same machine: they can reach `127.0.0.1:7681`, though they still need a valid Access token for a listed email to get anywhere. Keep your home directory and the secret files private (see the checklist).
- A compromised Cloudflare account with admin rights on your account: it controls the policy and the tunnel.
  Give other people only **Minimal Account Access**.
- Anything the mapped Linux user could already do: there's no sandbox beyond normal Unix permissions.

## Reporting vulnerabilities

Please report security issues privately. See [SECURITY.md](https://github.com/syan-dev/cloudflare-tmux/blob/main/SECURITY.md).
