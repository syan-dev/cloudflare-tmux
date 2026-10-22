---
title: API token
description: The Cloudflare API token permissions cloudflare-tmux needs, why each one is required, and how to keep the token small.
---

# API token

`scripts/cloudflare.sh` sets up Cloudflare through the [Cloudflare API](https://developers.cloudflare.com/api/),
so it needs an API token. It's a **setup-only** credential: the running services never use it (the tunnel
has its own run token in `~/.cloudflared/cloudflare-tmux.token`).

Create a **custom token** at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

## When you need it

Only to **change what's on Cloudflare**: the tunnel, the Access application and policy, the login method, and
the DNS record. Those are all made by `scripts/cloudflare.sh`, which `install.sh` runs. Everything else runs on
your server and never needs a token.

| Task | API token? | What to run |
|---|---|---|
| First install | **Yes** | `./install.sh` |
| Re-run `./install.sh` for any reason | **Yes** | it always runs `cloudflare.sh` |
| Add a person | **Yes** | edit `IDENTITIES`, `scripts/cloudflare.sh`, then restart the app |
| Remove a person | No, to lock them out<br>**Yes**, to tidy the Access policy | edit `IDENTITIES` and restart the app (immediate); `scripts/cloudflare.sh` later |
| Change the hostname, `PORT` or `TUNNEL_NAME` | **Yes** | `scripts/cloudflare.sh` |
| Change how long a Cloudflare login lasts (`ACCESS_SESSION`) | **Yes** | `scripts/cloudflare.sh` |
| Replace a leaked tunnel token | **Yes** | delete the tunnel in the dashboard, then `scripts/cloudflare.sh` and `scripts/setup.sh` |
| Map an already-listed email to a different Linux user | No | edit `IDENTITIES`, restart the app |
| Turn on the two-step code, enroll or remove a phone | No | `scripts/totp.js`, `TOTP=required`, restart |
| Update the app (`git pull`) | No | `scripts/setup.sh` (multi-user: also `install-system.sh`) |
| Update `cloudflared` | No | `scripts/install-cloudflared.sh --restart` |
| Switch to the multi-user install | No | `scripts/install-system.sh` (if `IDENTITIES` didn't change) |
| Restart, logs, status | No | `systemctl --user ...`, `journalctl --user ...` |
| Uninstall | No | dashboard (see [Operations](../operations.md#uninstall)) |

Anything marked **Yes** can also be done by hand in the Zero Trust dashboard, without a token
([Doing it by hand](what-gets-created.md#doing-it-by-hand)). But the next `cloudflare.sh` run overwrites the
Access application and policy with what's in your config.

When a task needs it, create a fresh token with the permissions below and a short expiry, run the
command, then [delete the token](#after-setup-delete-it).

## Permissions

| Scope | Permission | Access | Used for |
|---|---|---|---|
| Account | **Cloudflare Tunnel** | Edit | create the tunnel, set its ingress rules, fetch its run token |
| Account | **Access: Apps and Policies** | Edit | create or update the Access application and its allow policy |
| Account | **Access: Organizations, Identity Providers, and Groups** | Read | read your team domain; find the Cloudflare login method |
| Zone | **DNS** | Edit | create or update the proxied CNAME `term.example.com → <tunnel>.cfargotunnel.com` |

Each one is a piece of the setup, and leaving one out breaks it:

- without **Tunnel**, nothing connects your machine to Cloudflare;
- without **Access: Apps and Policies**, there's no login in front of the hostname;
- without **Organizations…: Read**, the app can't verify Access logins (it needs your team domain);
- without **DNS**, the hostname doesn't resolve.

### If the login method is missing

The script uses Zero Trust's **Cloudflare** login method ("Sign in with Cloudflare"). If your account
doesn't have it yet, the script has to create it, and that one call needs **Edit** on *Access:
Organizations, Identity Providers, and Groups*. The script stops and tells you if that's the case. Pick one:

- add it yourself once: **Zero Trust → Settings → Authentication → Login methods → Add new → Cloudflare**,
  with **restrict to account members** on, then re-run; or
- give the token **Edit** for the first run. Read is enough for every run after that.

## Keep the token small

When you create it:

- **Account Resources**: *Include → the one account* that owns the zone.
- **Zone Resources**: *Include → Specific zone → example.com*, so it can't touch your other domains.
- **Client IP Address Filtering** (optional): only your server's public IP.
- **TTL**: an end date a day or so away. You only need the token while the script runs.

## After setup: delete it

Delete the token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
once the setup works. Nothing breaks: the tunnel runs on its own token, and the Access application, login
method and DNS record are stored in Cloudflare, not tied to the API token.

Deleting beats downgrading it to Read: a read-only token is still a credential to protect, and re-running
`install.sh` or `cloudflare.sh` (to change `IDENTITIES` or the hostname) needs the Edit permissions again
anyway. Create a fresh short-lived token when you need one, then delete it again.

## Giving the token to the scripts

You don't save it anywhere. `install.sh` and `cloudflare.sh` **ask for it** when they need it (the input is
hidden), keep it in memory for that run, and forget it when they finish. It's never written to disk.

```bash
./install.sh                              # asks for the token
scripts/cloudflare.sh term.example.com    # asks for the token
```

For unattended runs (`install.sh --yes`, provisioning tools), pass it as `CF_API_TOKEN` instead, from your
secret store rather than typed on the command line.

The scripts send it to `curl` as a header from a file descriptor, never as a command-line argument,
so other users on the machine can't read it with `ps`.

> [!NOTE]
> Older versions saved the token to `~/.cloudflare-token`. It's no longer read, and the scripts remind you to
> delete it: `rm ~/.cloudflare-token`.

> [!CAUTION]
> Anyone with this token can change your tunnels and Access policies, and so could open your terminal to
> themselves. Treat it like a password, and revoke it when setup is done.

## Check the token

```bash
read -rsp 'Token: ' T; echo
curl -s -H @<(printf 'Authorization: Bearer %s\n' "$T") \
  https://api.cloudflare.com/client/v4/user/tokens/verify; unset T
```

You should see `"status": "active"`.
