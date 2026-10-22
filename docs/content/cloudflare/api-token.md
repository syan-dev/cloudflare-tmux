---
title: API token
description: The Cloudflare API token permissions cloudflare-tmux needs, and why each one is required.
---

# API token

`scripts/cloudflare.sh` sets up Cloudflare through the [Cloudflare API](https://developers.cloudflare.com/api/),
so it needs an API token. Create a **custom token** at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## Permissions

| Scope | Permission | Access | Used for |
|---|---|---|---|
| Account | **Cloudflare Tunnel** | Edit | create the tunnel, set its ingress rules, fetch its run token |
| Account | **Access: Apps and Policies** | Edit | create or update the Access application and its allow policy |
| Account | **Access: Organizations, Identity Providers, and Groups** | Edit | read your team domain; find or create the Google login method |
| Zone | **DNS** | Edit | create or update the proxied CNAME `term.example.com → <tunnel>.cfargotunnel.com` |

Under **Account Resources**, pick the account that owns the zone. Under **Zone Resources**, choose
**Specific zone → example.com** so the token can't touch your other domains.

> [!TIP]
> If Google login is already set up in Zero Trust, **Read** access is enough for *Access: Organizations,
> Identity Providers, and Groups*. The script only reads them in that case.

## Where the token is stored

The scripts use the first one they find:

1. the `CF_API_TOKEN` environment variable, or
2. `~/.cloudflare-token` (the installer writes it there with mode `600`).

```bash
(umask 077; echo 'your-token' > ~/.cloudflare-token)
```

The token is only used when you run `install.sh` or `scripts/cloudflare.sh`. The running services never
read it; the tunnel uses its own run token in `~/.cloudflared/cloudflare-tmux.token`.

> [!CAUTION]
> Anyone with this token can change your tunnels and Access policies, so treat it like a password. After
> setup you can revoke it or set a short expiry, and create a new one when you need to re-run the script.

## Check the token

```bash
curl -s -H "Authorization: Bearer $(cat ~/.cloudflare-token)" \
  https://api.cloudflare.com/client/v4/user/tokens/verify
```

You should see `"status": "active"`.
