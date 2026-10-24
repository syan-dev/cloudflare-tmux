---
title: Cloudflare login
description: Sign in with your Cloudflare account. Invite people as members, map their emails to Linux users, and protect the accounts with 2FA.
---

# Cloudflare login

Each person has two identities here. Their **Cloudflare account email** is what they log in with. Their
**Linux user** is the account their shell runs as. `IDENTITIES` maps one to the other.

Everyone signs in with their own Cloudflare account. Cloudflare Access lets a person through only if they're a
**member of your Cloudflare account** and their email is on your list of who may log in, `IDENTITIES` in the
config file.

How they sign in to Cloudflare is up to them: a password, or Cloudflare's own Google or Apple sign-in.
Access always sees their Cloudflare account email.

## Add or remove a person

See [Add a person](../add-a-person.md). In short:

```bash
./install.sh add carol@example.com carol     # asks for a short-lived API token
./install.sh remove carol@example.com        # no token needed
./install.sh list
```

## Protect the accounts

Every listed Cloudflare account is a key to a shell on your server.

- Ask each person to turn on **two-factor authentication** in their Cloudflare profile, under
  **My Profile → Authentication**. An authenticator app or a security key both work.
- As the owner, you can make it mandatory. Look for the option to **enforce two-factor authentication for
  members** in your account's member settings.
- For a second check that lives on your server, turn on the app's [two-step code](../two-step.md).

## How the login method works

`scripts/cloudflare.sh` uses Zero Trust's **Cloudflare** login method, the one labelled "Sign in with
Cloudflare". Zero Trust usually creates it for you. If it's missing, the script creates it with
**restrict to account members** turned on.

If the existing login method isn't restricted to members, the script prints a warning. Turn the restriction
on under **Zero Trust → Settings → Authentication**. Without it, Access checks only the email, not membership.

The Access application allows only this login method and redirects straight to it. See
[What gets created](what-gets-created.md).
