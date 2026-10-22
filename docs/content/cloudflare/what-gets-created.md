---
title: What gets created
description: Every Cloudflare object scripts/cloudflare.sh creates or updates, in order, and how to do the same by hand.
---

# What gets created

`install.sh` runs `scripts/cloudflare.sh <hostname>` to set up Cloudflare. The script is safe to re-run: it finds
existing objects by name or hostname and updates them. It works through these steps in order.

## 1. Tunnel

- A **remotely managed** Cloudflare Tunnel named `cloudflare-tmux`. Change the name with `TUNNEL_NAME`.
- The tunnel's **ingress rules**, which tell Cloudflare where to send traffic. They're stored in Cloudflare,
  so there's no local `config.yml`:

  ```json
  [
    { "hostname": "term.example.com", "service": "http://127.0.0.1:7681" },
    { "service": "http_status:404" }
  ]
  ```

- The tunnel's **run token**, saved to `~/.cloudflared/cloudflare-tmux.token` with mode `600`. The
  `cloudflare-tmux-cloudflared` service starts `cloudflared` with it.

## 2. Cloudflare login method

The script looks for the login method of type `cloudflare`, labelled "Sign in with Cloudflare". Zero Trust
usually creates it for you. If it's missing, the script creates it with **restrict to account members** on.
If it exists but isn't restricted, the script prints a warning. See [Cloudflare login](cloudflare-login.md).

## 3. Access application and policy

A **self-hosted** Access application for the hostname:

| Setting | Value | Why |
|---|---|---|
| Domain | `term.example.com` | the whole hostname is protected |
| Login methods | Cloudflare only | no one-time PIN codes or other providers |
| Instant auth | on | goes straight to the Cloudflare sign-in |
| Session duration | `ACCESS_SESSION`, default 24h | how often people sign in again |
| Cookie | `HttpOnly`, `SameSite=Lax` | page scripts can't read it |
| Policy "Mapped Cloudflare accounts" | **Allow** each email in `IDENTITIES` | only listed people get in |

The script then reads two values from Cloudflare and writes them to `~/.config/cloudflare-tmux/env`: the
application's **AUD tag** as `CF_ACCESS_AUD`, and your **team domain** as `CF_TEAM_DOMAIN`. The app uses both
to verify logins.

> [!IMPORTANT]
> The Access application is created **before** the DNS record. The hostname therefore never resolves without
> protection, even if you stop the script halfway.

## 4. DNS record

A **proxied** CNAME from `term.example.com` to `<tunnel-id>.cfargotunnel.com`, with the comment
`cloudflare-tmux tunnel`. An existing record with that name is **replaced**, so don't pick a hostname you
already use.

## 5. Local config

`~/.config/cloudflare-tmux/env`, mode `600`, gets `PUBLIC_HOST`, `TUNNEL_NAME`, `PORT`, `CF_TEAM_DOMAIN` and
`CF_ACCESS_AUD`. `IDENTITIES` is whatever you entered.

## Doing it by hand

If you'd rather not give the script an API token, make the same setup in the dashboard:

1. **Create the tunnel.** **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**, named
   `cloudflare-tmux`.
2. **Save its token.** Copy the long string after `--token` in the install command it shows into
   `~/.cloudflared/cloudflare-tmux.token`.
3. **Create the Access application.** **Zero Trust → Access → Applications → Add → Self-hosted**: domain
   `term.example.com`, login method Cloudflare only, instant auth on. Add an **Allow** policy with
   **Include → Emails** for each person.
4. **Fill in the config.** Copy the application's **Application Audience (AUD) Tag** into
   `~/.config/cloudflare-tmux/env` as `CF_ACCESS_AUD`. Set `CF_TEAM_DOMAIN=<team>.cloudflareaccess.com` and
   `IDENTITIES=...`.
5. **Add the public hostname.** In the tunnel, add `term.example.com` with service `HTTP` and URL
   `127.0.0.1:7681`. This also creates the DNS record.
6. **Install the services.** Run `scripts/setup.sh`, and `scripts/install-system.sh` for multi-user.

> [!WARNING]
> Create the Access application (step 3) before you add the public hostname (step 5). Otherwise the shell is
> briefly reachable without Access. The app would still reject requests without a valid login, but don't rely
> on a single layer.
