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

## 3. Set up Google login (once per Zero Trust account)

If **Google** isn't already a login method in Zero Trust, create a Google OAuth client using
[Google login](cloudflare/google-login.md). Keep the **client ID** and **client secret** handy; the
installer can register them with Cloudflare for you.

## 4. Run the installer

```bash
./install.sh
```

It will:

1. check prerequisites and offer to download `cloudflared` if it's missing,
2. ask for the **hostname** (for example `term.example.com`) and **who may log in**
   (`you@gmail.com:youruser`, where the part after `:` is your Linux username),
3. ask for the API token and, if needed, the Google OAuth client,
4. create the tunnel, Google login, Access application and DNS record ([details](cloudflare/what-gets-created.md)),
5. install and start two systemd user services: the app and the tunnel.

To run without prompts (for scripts or provisioning tools):

```bash
CF_API_TOKEN=... ./install.sh --yes \
  --host term.example.com \
  --identities you@gmail.com:youruser
```

## 5. Open it

Go to `https://term.example.com`, sign in with Google, create a session and start working. Close the tab
whenever you like; the session keeps running.

> [!IMPORTANT]
> Turn on 2-Step Verification (or a passkey) for every Google account you allow. That account is now the key to a shell on your server.

## What's next

- Other people, each with their own Linux user? See [Multi-user install](install/multi-user.md).
- Want to change something? Re-run `./install.sh` at any time; it's safe to re-run.
- Something not working? See [Troubleshooting](troubleshooting.md).
