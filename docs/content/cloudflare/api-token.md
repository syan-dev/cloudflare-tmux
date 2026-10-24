---
title: API token
description: The Cloudflare API token the setup scripts need, when you need it, and how to keep it small.
---

# API token

`scripts/cloudflare.sh` sets up Cloudflare through its API, so it needs an API token. `install.sh` runs that
script for you. The token is a setup-only credential: nothing that runs day to day uses it, and the scripts
never save it.

## Create it

Create a **custom token** at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
with these permissions:

| Scope | Permission | Access | Used for |
|---|---|---|---|
| Account | **Cloudflare Tunnel** | Edit | the tunnel and its run token |
| Account | **Access: Apps and Policies** | Edit | the Access application and its policy |
| Account | **Access: Organizations, Identity Providers, and Groups** | Read | your team domain and the login method |
| Zone | **DNS** | Edit | the `term.example.com` record |

Leaving one out breaks that part of the setup.

Keep the token small:

- **Account Resources**: include only the account that owns the zone.
- **Zone Resources**: include only the zone you're using, so the token can't touch your other domains.
- **Client IP Address Filtering**, optional: only your server's public IP.
- **TTL**: a day or so. You need the token only while the script runs. Set the **start date to today**. A
  start date of tomorrow makes every call fail with "Invalid access token".

> [!CAUTION]
> Anyone with this token can change your tunnels and Access policies, and so could open your terminal to
> themselves. Treat it like a password.

## When you need it

Short version: adding a person needs one, almost nothing else does. See
[Do I need a token every time?](../add-a-person.md#do-i-need-a-token-every-time) for the table.


Only when you **change something on Cloudflare**. Everything else runs on your server without a token.

**Needs a token**

- the first install, and any re-run of `./install.sh`
- adding a person with `cloudflare-tmux add`
- changing the hostname, `PORT`, `TUNNEL_NAME` or `ACCESS_SESSION`
- replacing a leaked tunnel token
- tidying the Access policy after removing a person

**Never needs a token**

- locking someone out: `cloudflare-tmux remove their@email`
- mapping an already-listed email to a different Linux user
- the two-step code: turning it on, enrolling or removing a phone
- updating the app or `cloudflared`
- switching to the multi-user install
- restarts, logs, status, uninstall

Each time you need one, create a fresh token, run the command, then delete the token again.

You can also make the same changes by hand in the Zero Trust dashboard. But the next `cloudflare.sh` run
overwrites the Access application and policy with what's in your config. See
[Doing it by hand](what-gets-created.md#doing-it-by-hand).

## If the login method is missing

The script uses Zero Trust's **Cloudflare** login method. If your account doesn't have it yet, the script has
to create it, and that one call needs **Edit** instead of Read on *Access: Organizations, Identity Providers,
and Groups*. The script stops and tells you if so. Either:

- add it once yourself under **Zero Trust → Settings → Authentication → Login methods → Add new → Cloudflare**,
  with **restrict to account members** on, then re-run; or
- give the token Edit for that first run. Read is enough afterwards.

## Delete it afterwards

Once the setup works, delete the token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). Nothing breaks: the
tunnel has its own run token, and the Access application, login method and DNS record live in Cloudflare.

Deleting is better than downgrading it to read-only. A read-only token is still a credential to protect, and
the next change needs Edit anyway.

## How the scripts take it

`install.sh` and `cloudflare.sh` ask for the token when they need it. The input is hidden, the token stays in
memory for that run, and it's never written to disk. The scripts pass it to `curl` through a file descriptor,
never on a command line, so other users on the machine can't see it in `ps`.

For unattended runs, pass it as `CF_API_TOKEN` from your secret store:

```bash
CF_API_TOKEN=... ./install.sh --yes --host term.example.com --identities you@example.com:$USER
```

## If the token is refused

`cloudflare.sh` verifies the token before using it. If Cloudflare rejects it, the script says why when it can:
a start date in the future, an expired token, or a scope that doesn't cover the account or zone. See
[Troubleshooting](../troubleshooting.md#cloudflaresh-says-invalid-access-token-or-the-token-is-not-valid-yet).

## Check the token

```bash
read -rsp 'Token: ' T; echo
curl -s -H @<(printf 'Authorization: Bearer %s\n' "$T") \
  https://api.cloudflare.com/client/v4/user/tokens/verify; unset T
```

You should see `"status": "active"`.
