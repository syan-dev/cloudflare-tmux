---
title: Cloudflare login
description: Sign in with your Cloudflare account. Invite people as members, map their emails to Linux users, and protect the accounts with 2FA.
---

# Cloudflare login

Everyone signs in with their own Cloudflare account. Cloudflare Access lets a person through only if they're a
**member of your Cloudflare account** and their email is on your list of who may log in, `IDENTITIES` in the
config file.

How they sign in to Cloudflare is up to them: a password, or Cloudflare's own Google or Apple sign-in.
Access always sees their Cloudflare account email.

## Add a person

You're already a member of your own account. For everyone else:

1. **Invite them.** In the [Cloudflare dashboard](https://dash.cloudflare.com), go to
   **Manage Account → Members → Invite** and enter the email of **their** Cloudflare account. They can create a
   free one.
2. **Give them the role Minimal Account Access.** That makes them a member without letting them see or change
   your zones, tunnels or Access settings. Never give them an administrator or Zero Trust role.
3. **Wait for them to accept** the invitation, from the email or from their own dashboard.
4. **Add them to the list.** In `~/.config/cloudflare-tmux/env`, add `their-email:linux-user` to `IDENTITIES`.
   People mapped to the same Linux user share its sessions.
5. **Create a short-lived [API token](api-token.md#create-it).** The one from setup wasn't saved, and adding a
   person changes the Access policy on Cloudflare.
6. **Update Cloudflare and restart the app.** The first command asks for the token.

   ```bash
   scripts/cloudflare.sh term.example.com
   scripts/setup.sh
   ```

7. **Delete the token** at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

Being a member alone isn't enough. A member whose email isn't on the list is refused, both by Access and by
the app.

> [!NOTE]
> After joining, the Cloudflare dashboard may open on **your** account, where almost everything is locked for
> them. That's expected. The **account switcher** at the top of the dashboard takes them back to their own
> account. Joining doesn't change anything in their own account.

## Remove a person

1. **Lock them out now.** Remove their entry from `IDENTITIES` and restart the app. No token needed.

   ```bash
   systemctl --user restart cloudflare-tmux
   ```

   From then on the app refuses them, even with a valid Cloudflare login.
2. **Tidy up later.** Run `scripts/cloudflare.sh term.example.com` with a fresh [API token](api-token.md#create-it)
   to take them out of the Access policy too.
3. **Optionally** remove them under **Manage Account → Members**, and run `scripts/totp.js remove their@email`
   if you use the [two-step code](../two-step.md).

Their tmux sessions keep running after the lockout. See
[If something goes wrong](../security.md#if-something-goes-wrong) for a full cleanup.

> [!NOTE]
> **Multi-user install:** create the Linux user first with `sudo adduser carol`. Then, wherever this page says
> `scripts/setup.sh` or a restart, run `sudo NODE_BIN="$(command -v node)" scripts/install-system.sh` instead.
> See [Multi-user install](../install/multi-user.md).

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
