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

## Add a person

Two things have to be true before someone can log in. They must be a **member of your Cloudflare account**,
and their email must be **on your list**. One command handles the list, Cloudflare and the restart.

1. **Invite them.** In the [Cloudflare dashboard](https://dash.cloudflare.com), go to
   **Manage Account → Members → Invite** and enter the email of **their** Cloudflare account. They can create a
   free one.
2. **Give them the role Minimal Account Access.** That makes them a member without letting them see or change
   your zones, tunnels or Access settings. Never give them an administrator or Zero Trust role.
3. **Wait for them to accept** the invitation, from the email or from their own dashboard.
4. **Create a short-lived [API token](api-token.md#create-it).** Adding a person changes the Access policy on
   Cloudflare. Set the token's start date to today.
5. **Run one command.** It asks for the token, which it never saves.

   ```bash
   scripts/people.sh add carol@example.com carol
   ```

   The second argument is the Linux user they get. Leave it out to map them to your own user. People mapped
   to the same Linux user share its sessions.
6. **Delete the token** at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).

The command checks that the Linux user exists, adds `carol@example.com:carol` to `IDENTITIES` in
`~/.config/cloudflare-tmux/env`, updates the Access policy and restarts the app.

If you map someone to a Linux user **other than your own**, the app must run as root to start tmux as that
user. The command explains this and offers to switch to the [multi-user install](../install/multi-user.md).
The switch needs `sudo`. Create the Linux user first with `sudo adduser carol`.

Being a member alone isn't enough. A member whose email isn't on the list is refused, both by Access and by
the app. The app shows them a page that says so and names the command to run.

> [!NOTE]
> After joining, the Cloudflare dashboard may open on **your** account, where almost everything is locked for
> them. That's expected. The **account switcher** at the top of the dashboard takes them back to their own
> account. Joining doesn't change anything in their own account.

## See who may log in

```bash
scripts/people.sh list
```

It also tells you which install you have, single-user or multi-user.

## Remove a person

1. **Lock them out now.** No token needed. The app refuses them from then on, even with a valid Cloudflare login.

   ```bash
   scripts/people.sh remove carol@example.com
   ```

2. **Tidy up later.** Run `scripts/cloudflare.sh` with a fresh [API token](api-token.md#create-it) to take them
   out of the Access policy too. If `CF_API_TOKEN` is set, the remove command does this for you.
3. **Optionally** remove them under **Manage Account → Members**, and run `scripts/totp.js remove their@email`
   if you use the [two-step code](../two-step.md).

Their tmux sessions keep running after the lockout. See
[If something goes wrong](../security.md#if-something-goes-wrong) for a full cleanup.

## By hand

The command does nothing you can't do yourself:

1. Edit `IDENTITIES` in `~/.config/cloudflare-tmux/env`.
2. Run `scripts/cloudflare.sh term.example.com` to update the Access policy. Skip this when removing someone
   in a hurry.
3. Restart the app. Single-user install: `systemctl --user restart cloudflare-tmux`. Multi-user install:
   `sudo NODE_BIN="$(command -v node)" scripts/install-system.sh`.

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
