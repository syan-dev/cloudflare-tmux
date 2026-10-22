---
title: Cloudflare login
description: Sign in with your Cloudflare account - invite members, map their emails to Linux users, and protect the accounts with 2FA.
---

# Cloudflare login

cloudflare-tmux uses **Sign in with Cloudflare** as its only login method. Each person signs in with their
**own Cloudflare account**, and Access only lets in accounts that are **members of your Cloudflare account**
and whose email is in `IDENTITIES`. You don't need an OAuth client or any other identity provider.

People sign in to their Cloudflare account however Cloudflare allows: email and password, or Cloudflare's
own Google or Apple sign-in options. Whatever they use, Access sees their Cloudflare account email.

## 1. Invite each person as a member

You (the account owner) are already a member. For everyone else:

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Manage Account → Members → Invite**.
2. Enter the email of **their** Cloudflare account (they can create a free one).
3. Role: **Minimal Account Access**. This makes them a member without letting them view or change your zones,
   DNS, tunnels or Access settings. Don't give them an administrator or Zero Trust role.
4. They accept the invitation from the email or from their own dashboard.

> [!NOTE]
> After joining, the Cloudflare dashboard may open on **your** account, where almost everything is locked
> for them. That's expected. They can switch back to their own account with the **account switcher** at the
> top of the dashboard. Joining doesn't change anything in their own account.

## 2. Map the email to a Linux user

Add `their-email:linux-user` to `IDENTITIES` in `~/.config/cloudflare-tmux/env`, then re-run the setup so the Access policy and the app
agree:

```bash
scripts/cloudflare.sh term.example.com
```

The Access policy (**Mapped Cloudflare accounts**) allows exactly these emails, and the app checks them
again after verifying the Access JWT. Being a member alone isn't enough: someone who is a member but isn't
in `IDENTITIES` is refused.

## 3. Turn on two-factor authentication

Each allowed Cloudflare account is now a key to a shell on your server, so protect it:

- Each person turns on **two-factor authentication** in their Cloudflare profile (**My Profile →
  Authentication**), with an authenticator app or a security key.
- As the owner, you can make it mandatory: look for the option to **enforce two-factor authentication for
  members** in your account's member settings (**Manage Account → Members** / account settings).

For a second layer that you control on the server, add the app's [two-step code](../two-step.md).

## What the setup script does

`scripts/cloudflare.sh` finds the identity provider of type `cloudflare`, which Zero Trust usually creates
for you. If it doesn't exist, the script creates it with `restrict_to_account_members` turned on. If the
existing one isn't restricted to members, the script prints a warning: turn the restriction on in
**Zero Trust → Settings → Authentication**, or anyone with a Cloudflare account and a listed email could
sign in.

The Access application allows only this login method and redirects straight to it. See
[What gets created](what-gets-created.md).

## Removing a person

1. Remove their entry from `IDENTITIES` and re-run `scripts/cloudflare.sh` (and `install-system.sh` in
   multi-user mode). They're out of the Access policy and the app's allow-list.
2. Optionally remove them under **Manage Account → Members**.
3. If you use the two-step code: `scripts/totp.js remove their@email`.
