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
| Account | Access: Organizations, Identity Providers, and Groups | Edit |
| Zone | DNS | Edit (only the zone you'll use) |

The installer asks for this token and saves it to `~/.cloudflare-token` with mode `600`. See [API token](cloudflare/api-token.md) for why each permission is needed.

## 3. Run the installer

Start with just yourself. You'll add other people [later](#5-add-more-people-later).

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

> [!IMPORTANT]
> Turn on two-factor authentication on your Cloudflare account. It's now the key to a shell on your server.
> For an extra layer, require a [two-step code](two-step.md) in the app itself.

## 5. Add more people (later)

Login is **Sign in with Cloudflare**, and only members of *your* Cloudflare account get through. To let
someone else in:

1. **Invite them:** **Manage Account → Members → Invite**, role **Minimal Account Access**. They accept the
   invitation from their own Cloudflare account. See [Cloudflare login](cloudflare/cloudflare-login.md).
2. **Map them** by re-running the installer with everyone listed:

   ```bash
   ./install.sh --identities you@example.com:$USER,friend@example.com:$USER
   ```

   This updates the Access allow-list and restarts the app; your tmux sessions keep running.
   Mapping several people to your own Linux user means they share your sessions. To give each person
   their own Linux user, see [Multi-user install](install/multi-user.md).

## What's next

- Want to change something? Re-run `./install.sh` at any time; it's safe to re-run.
- Something not working? See [Troubleshooting](troubleshooting.md).
