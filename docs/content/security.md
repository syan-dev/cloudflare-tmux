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

- **Google is the only login method.** There are no one-time email codes and no other providers.
- An **Allow** policy includes exactly the emails in `IDENTITIES`. Nobody else gets past Cloudflare's edge.
- The session cookie is `HttpOnly` and `SameSite=Lax`, and expires after 24h.

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
cross-site WebSocket hijacking and CSRF that would otherwise ride on your Access cookie.

### 5. Fixed identity → account mapping

- No Linux password is ever typed into a web page.
- The email → user mapping lives on the server, and users can't choose an account.
- `root` / UID 0 can never be mapped, and accounts with `nologin`/`false` shells are refused.
- In single-user mode, emails mapped to any user other than the one running the service are refused.

### 6. Privilege separation (multi-user)

- tmux runs through `setpriv --reuid --regid --init-groups --reset-env`, so each person's processes have their own uid, gid and groups, and a clean environment.
- The root service runs only **root-owned** code from `/opt/cloudflare-tmux`. No user can change what root executes.
- Its config (`/etc/cloudflare-tmux/env`) is readable only by root.

### 7. Hardened HTTP

`Content-Security-Policy: default-src 'self'`, `X-Frame-Options: DENY` (no clickjacking),
`Referrer-Policy: no-referrer`, `Cache-Control: no-store`, small request-body limits, and validated
session names (`[A-Za-z0-9_-]{1,32}`) that are always passed as separate arguments, never through a shell.

## Your part

> [!IMPORTANT]
> - Turn on **2-Step Verification or a passkey** for every allowed Google account.
> - Keep the **API token** secret, or revoke it after setup ([API token](cloudflare/api-token.md)).
> - Keep the OS, Node.js, tmux and `cloudflared` up to date.
> - Only map people you'd give an SSH login to, because that's what this is.

Other hardening worth considering:

- **Shorter sessions**: lower the Access application's session duration in Zero Trust.
- **Device posture / country rules**: add *Require* rules to the Access policy (for example WARP or a country) in the dashboard.
  The script overwrites the policy on re-run, so if you customize it, stop re-running `cloudflare.sh` or edit the script.
- **Audit**: Zero Trust → Logs → Access shows every login, and `journalctl -u cloudflare-tmux` shows every attach and detach with the email.

## What it doesn't protect against

- A compromised Google account on the allow-list: that person gets that user's shell. Use 2FA.
- A compromised Cloudflare account: it controls the policy and the tunnel.
- Anything the mapped Linux user could already do: there's no sandbox beyond normal Unix permissions.

## Reporting vulnerabilities

Please report security issues privately. See [SECURITY.md](https://github.com/syan-dev/cloudflare-tmux/blob/main/SECURITY.md).
