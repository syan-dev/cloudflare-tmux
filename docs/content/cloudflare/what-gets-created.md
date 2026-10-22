---
title: What gets created
description: Every Cloudflare object scripts/cloudflare.sh creates or updates, in order, and how to do the same by hand.
---

# What gets created

`scripts/cloudflare.sh <hostname>` (run by `install.sh`) is **idempotent**: it finds existing objects by name
or hostname and updates them, so running it again is always safe. These are the steps, in order:

## 1. Tunnel

- A **remotely managed** Cloudflare Tunnel named `cloudflare-tmux` (change it with `TUNNEL_NAME`).
- Its **ingress** rules, stored in Cloudflare (no local `config.yml`):

  ```json
  [
    { "hostname": "term.example.com", "service": "http://127.0.0.1:7681" },
    { "service": "http_status:404" }
  ]
  ```

- The tunnel **run token**, saved to `~/.cloudflared/cloudflare-tmux.token` (mode `600`). The
  `cloudflare-tmux-cloudflared` service runs `cloudflared tunnel run --token-file` with it.

## 2. Cloudflare login method

The script looks for the identity provider of type `cloudflare` ("Sign in with Cloudflare"). Zero Trust
usually creates it for you. If there isn't one, the script creates it with `restrict_to_account_members`
on, so only members of your Cloudflare account can sign in. If the existing one isn't restricted, the
script prints a warning. See [Cloudflare login](cloudflare-login.md).

## 3. Access application and policy

A **self-hosted** Access application for the hostname:

| Setting | Value | Why |
|---|---|---|
| Domain | `term.example.com` | the whole hostname is protected |
| Login methods | Cloudflare login only | one login method, no one-time PIN codes |
| Instant auth (`auto_redirect_to_identity`) | on | goes straight to the Cloudflare sign-in |
| Session duration | 24h | how often you sign in again |
| Cookie | `HttpOnly`, `SameSite=Lax` | the token isn't readable by page scripts |
| Policy "Mapped Cloudflare accounts" | **Allow**, include = each email in `IDENTITIES` | only listed people get in |

The script then reads the application's **AUD tag** and your **team domain** and writes them to `.env` as
`CF_ACCESS_AUD` and `CF_TEAM_DOMAIN`, which the app uses to verify JWTs.

> [!IMPORTANT]
> The Access application is created **before** the DNS record. The hostname therefore never resolves
> without protection, even if you stop the script halfway.

## 4. DNS record

A **proxied** CNAME: `term.example.com → <tunnel-id>.cfargotunnel.com` (comment: `cloudflare-tmux tunnel`).
If a record with that name already exists, it's **replaced**, so don't pick a hostname you already use.

## 5. Local config

`.env` (mode `600`) gets `PORT`, `CF_TEAM_DOMAIN` and `CF_ACCESS_AUD`. `IDENTITIES` is whatever you entered.

## Doing it by hand

If you'd rather not give the script an API token, you can make the same setup in the dashboard:

1. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, named `cloudflare-tmux`. Copy the
   token from the install command it shows (the long string after `--token`) into
   `~/.cloudflared/cloudflare-tmux.token`.
2. In the tunnel, add a **public hostname**: `term.example.com`, service `HTTP`, URL `127.0.0.1:7681`.
   This also creates the DNS record.
3. **Zero Trust → Access → Applications → Add → Self-hosted**: domain `term.example.com`, login method
   Cloudflare only, instant auth on. Add an **Allow** policy with **Include → Emails** for each person.
4. Copy the application's **Application Audience (AUD) Tag** into `.env` as `CF_ACCESS_AUD`, and set
   `CF_TEAM_DOMAIN=<team>.cloudflareaccess.com` and `IDENTITIES=...`.
5. Run `scripts/setup.sh` (and `scripts/install-system.sh` for multi-user).

> [!WARNING]
> With the manual route, create the Access application **before** you add the public hostname. Otherwise
> the shell is briefly reachable without Access. The app would still reject requests without a valid JWT,
> but don't rely on a single layer.
