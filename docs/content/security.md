---
title: Security model
description: How cloudflare-tmux protects a shell on a public URL, layer by layer, and how to harden it.
---

# Security model

A web terminal is a remote shell, so cloudflare-tmux assumes any single layer can fail. A stranger would have
to get through every layer below to reach a shell.

## Layers

### 1. Nothing listens on the internet

The app binds to `127.0.0.1:7681`. `cloudflared` makes **outbound** connections to Cloudflare. There's no
inbound port to scan or brute-force, and your server's IP never appears in DNS.

### 2. Cloudflare Access in front

Every request to the hostname passes through Cloudflare Access first.

- The only login method is **Sign in with Cloudflare**, restricted to members of your Cloudflare account.
  There are no one-time email codes and no other providers.
- An **Allow** policy lists exactly the emails in `IDENTITIES`. Nobody else gets past Cloudflare's edge.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and expires after `ACCESS_SESSION`, by default 24 hours.

### 3. The app verifies the login again

Access attaches a signed token, a JWT, to each request, in the `Cf-Access-Jwt-Assertion` header and the
`CF_Authorization` cookie. The app doesn't trust Access blindly. On every HTTP request **and** every WebSocket
upgrade it:

- verifies the signature against your team's public keys,
- checks the token was issued by your team domain, for this application's AUD tag,
- checks the email is in its own `IDENTITIES` list.

So a misconfigured Access policy, a different Access application on the same team, or a request that reaches
port 7681 locally still can't open a shell. The app refuses to start without this configuration.

### 4. Same-origin checks

WebSocket upgrades and every non-GET request must carry an `Origin` header that matches the host. A missing
or malformed `Origin` is refused. This blocks cross-site WebSocket hijacking and CSRF riding on your Access
cookie.

### 5. Optional two-step code

With `TOTP=required`, passing Access isn't enough. The app also asks for a 6-digit authenticator code before
it lists sessions or opens a terminal. Authenticators are enrolled only on the server, codes can't be reused,
and guessing is rate-limited. See [Two-step code](two-step.md).

### 6. Fixed email → user mapping

- No Linux password is ever typed into a web page.
- The mapping lives on the server. Users can't choose an account.
- `root` and UID 0 can never be mapped. Accounts with a `nologin` or `false` shell are refused.
- In the single-user install, emails mapped to any user other than the one running the service are refused.

### 7. Privilege separation in the multi-user install

- tmux runs through `setpriv`, so each person's processes have their own uid, gid and groups, and a clean
  environment.
- The root service runs only **root-owned** code from `/opt/cloudflare-tmux`. No user can change what root
  executes.
- Its config in `/etc/cloudflare-tmux/env` is readable only by root.

### 8. Hardened HTTP

Strict headers: `Content-Security-Policy: default-src 'self'`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`. Small request-body limits. Session names are
validated against `[A-Za-z0-9_-]{1,32}` and always passed to tmux as separate arguments, never through a shell.

## Hardening checklist

Do this once after the [Quickstart](quickstart.md), and again whenever you add someone. Most steps need no
API token.

### 1. Cloudflare accounts

Every listed Cloudflare account is a key to a shell. Protect those accounts first.

- [ ] Turn on **two-factor authentication** on your own Cloudflare account, under
  **My Profile → Authentication**. Prefer a security key or an authenticator app.
- [ ] **Require 2FA for all members** in your account's member settings.
- [ ] Give everyone else **Minimal Account Access** only. An admin could change the Access policy or the
  tunnel and let themselves in.
- [ ] Check **Manage Account → Members** and remove anyone who shouldn't be there.

### 2. The API token

- [ ] Scope it to **one account** and **one zone**, with the [four permissions](cloudflare/api-token.md#create-it)
  and nothing more.
- [ ] Give it a **short expiry**, and optionally a **client IP filter** for your server.
- [ ] **Delete it** once setup works. Nothing running uses it.
- [ ] Don't keep a copy anywhere. The scripts ask for it when they need it.

### 3. The Access application

These change Cloudflare, so they need a token or the dashboard.

- [ ] **Shorten the login lifetime.** Set `ACCESS_SESSION=8h` or less in `~/.config/cloudflare-tmux/env`, then
  re-run `scripts/cloudflare.sh` with a token. Change it in the config, not the dashboard: `cloudflare.sh`
  overwrites the dashboard value on every run.
- [ ] Make sure the **Cloudflare** login method is restricted to account members. `cloudflare.sh` warns if it
  isn't.
- [ ] Optional: add **device posture or country rules** to the Access policy in the dashboard. `cloudflare.sh`
  replaces the policy on every run, so re-add them afterwards, or stop re-running it.

### 4. The app

- [ ] Turn on the [two-step code](two-step.md) with `TOTP=required`. It's checked on your server, so it still
  protects you if a Cloudflare account or the Access policy is compromised.
- [ ] Keep `TOTP_SESSION_HOURS` short, for example `8`.
- [ ] Map only people you'd give an SSH login to. Never a shared or admin account.
- [ ] Never set `AUTH_DISABLED=1` or a `HOST` other than `127.0.0.1` on a real install.

### 5. The server

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
- [ ] Check the hostname is protected, from any machine:

  ```bash
  curl -sI https://term.example.com | grep -i '^location'     # expect ...cloudflareaccess.com/...
  ```

- [ ] Keep the OS, Node.js and tmux patched, for example with `unattended-upgrades` on Debian and Ubuntu.
- [ ] Update `cloudflared` regularly with `scripts/install-cloudflared.sh --restart`. It doesn't update itself.
  See [Operations](operations.md#update-cloudflared).

### 6. Watch it

- [ ] **Zero Trust → Logs → Access** shows every login to the app, with email and IP.
- [ ] The app logs every attach, detach and refusal:

  ```bash
  journalctl --user -u cloudflare-tmux | grep -E 'attach|rejected'
  ```

  `auth rejected` and `2fa rejected` lines from people you don't expect are worth a look. In the multi-user
  install, use `sudo journalctl -u cloudflare-tmux`.

## If something goes wrong

If you think a person's Cloudflare account, a device or the API token is compromised, do these in order. The
first three need **no API token**, so you can act right away.

1. **Lock them out of the app.** Run `cloudflare-tmux remove their@email`. It removes them from
   `IDENTITIES` and restarts the app. The app refuses them immediately, even with a valid Cloudflare login,
   and the restart drops any open terminal.
2. **End what they left running.** Their tmux sessions survive the lockout. As that Linux user, check
   `tmux ls` and run `tmux kill-server`. Review `~/.ssh/authorized_keys`, crontabs and shell startup files for
   anything they added.
3. **Revoke at Cloudflare.** Revoke their Access sessions under **Zero Trust → Users → the person → Revoke
   session**. Remove or downgrade them under **Manage Account → Members**. Delete any API token that may have
   leaked.
4. **Remove them from the Access policy.** Run `scripts/cloudflare.sh` with a new short-lived
   [API token](cloudflare/api-token.md#create-it), then delete the token.
5. **If the tunnel token leaked.** Delete the tunnel under **Zero Trust → Networks → Tunnels**, then re-run
   `scripts/cloudflare.sh` and `scripts/setup.sh` with an API token. That creates a new tunnel with a new
   token. With the old token, someone could run their own connector for your hostname, though Access would
   still sit in front of it.
6. **If a phone with the two-step code was lost.** Run `scripts/totp.js remove their@email`, then
   `scripts/totp.js add` again on the new device.

## What it doesn't protect against

- A compromised Cloudflare account that's on the list. That person gets that user's shell. Use 2FA and the
  two-step code.
- Other users on the same machine. They can reach `127.0.0.1:7681`, though they still need a valid login for
  a listed email. Keep your home directory and the secret files private.
- A compromised Cloudflare account with admin rights on your account. It controls the policy and the tunnel.
  Give other people only **Minimal Account Access**.
- Anything the mapped Linux user could already do. There's no sandbox beyond normal Unix permissions.

## Reporting vulnerabilities

Please report security issues privately. See
[SECURITY.md](https://github.com/syan-dev/cloudflare-tmux/blob/main/SECURITY.md).
