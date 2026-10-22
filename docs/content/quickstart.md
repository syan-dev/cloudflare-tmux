---
title: Quickstart
description: Get cloudflare-tmux running on your server in about five minutes with one command.
---

# Quickstart

This page gets you from zero to a working `https://term.example.com` with one command. Each step links to a page with more detail.

> [!NOTE]
> Before you start you need a **domain on Cloudflare**, **Zero Trust enabled** (the Free plan is fine),
> and a Linux server with **systemd**, **tmux** and **Node.js 18+**. See [Prerequisites](prerequisites.md).

## 1. Get the code

```bash
git clone https://github.com/syan-dev/cloudflare-tmux.git
cd cloudflare-tmux
```

## 2. Create a Cloudflare API token

Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), choose
**Create Token → Create Custom Token**, and add these permissions:

| Scope | Permission | Access |
|---|---|---|
| Account | Cloudflare Tunnel | Edit |
| Account | Access: Apps and Policies | Edit |
| Account | Access: Organizations, Identity Providers, and Groups | Read |
| Zone | DNS | Edit (only the zone you'll use) |

Set an **expiry** (a day is plenty): the token is only used during setup. The installer asks for it and
keeps it in memory for that run; it isn't saved to disk. See [API token](cloudflare/api-token.md) for why
each permission is needed and how to narrow the token further.

> [!NOTE]
> If you've never used "Sign in with Cloudflare" in Zero Trust, the script has to create that login
> method, which needs **Edit** on the third permission. It tells you if so. See
> [API token](cloudflare/api-token.md#if-the-login-method-is-missing).

## 3. Run the installer

Start with just yourself. You'll add other people [later](#add-more-people).

```bash
./install.sh
```

It will:

1. check prerequisites and offer to download `cloudflared` if it's missing,
2. ask for the **hostname** (for example `term.example.com`) and **who may log in**. Enter
   `you@example.com:youruser`: the email you sign in to Cloudflare with, then your Linux username,
3. ask for the API token,
4. create the tunnel, Cloudflare login, Access application and DNS record ([details](cloudflare/what-gets-created.md)),
5. install and start two systemd user services: the app and the tunnel.

To run without prompts (for scripts or provisioning tools):

```bash
CF_API_TOKEN=... ./install.sh --yes \
  --host term.example.com \
  --identities you@example.com:$USER
```

## 4. Open it

Go to `https://term.example.com` and sign in with **your Cloudflare account**, the same one you used to set
this up. You're already a member of your own account, so there's nothing to invite. Create a session and
start working. Close the tab whenever you like; the session keeps running.

## 5. Delete the API token

Once it works, delete the token at
[dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) (**⋯ → Delete**).
Nothing that's running uses it: the tunnel has its own token, and the Access app and DNS record live on
Cloudflare's side. Day-to-day use, updates, restarts and the two-step code never need it. You only need a new one to
change what's on Cloudflare: adding people, the hostname, or the login lifetime. The full list is in
[when you need the API token](cloudflare/api-token.md#when-you-need-it). Then create a new token with the
same permissions, and delete it again afterwards.

Next, work through the [security checklist](security.md#hardening-checklist). It takes about ten minutes.

## What's next

### Add more people

Login is **Sign in with Cloudflare**, and only members of *your* Cloudflare account get through. To let
someone else in:

1. **Invite them:** **Manage Account → Members → Invite**, role **Minimal Account Access**. They accept the
   invitation from their own Cloudflare account. See [Cloudflare login](cloudflare/cloudflare-login.md).
2. **Create a short-lived API token** with the [same permissions](#2-create-a-cloudflare-api-token). The
   one from setup wasn't saved, and adding someone changes the Access allow-list on Cloudflare.
3. **Map them** by re-running the installer with everyone listed. It asks for the token:

   ```bash
   ./install.sh --identities you@example.com:$USER,friend@example.com:$USER
   ```

   This updates the Access allow-list and restarts the app; your tmux sessions keep running.
   Mapping several people to your own Linux user means they share your sessions. To give each person
   their own Linux user, see [Multi-user install](install/multi-user.md).
4. **Delete the token** again ([step 5](#5-delete-the-api-token)).

Removing someone doesn't need a token to take effect: see
[Changing who can log in](operations.md#changing-who-can-log-in).

### Secure it

Your Cloudflare account is now the key to a shell on your server.

- **Turn on two-factor authentication** on your Cloudflare account, and ask everyone you invite to do the same.
- For an extra layer, require a [two-step code](two-step.md) in the app itself.
- Read the [Security model](security.md) to see what protects the terminal and how to harden it further.

### More

- Want to change something? Re-run `./install.sh` at any time; it's safe to re-run.
- Something not working? See [Troubleshooting](troubleshooting.md).
