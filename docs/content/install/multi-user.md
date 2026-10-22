---
title: Multi-user install
description: Serve several people from one machine, each Cloudflare account email mapped to its own Linux user.
---

# Multi-user install

Use this when several people share a machine and each should get **their own Linux account**: their own
files, permissions, and tmux sessions.

```bash
./install.sh --multi-user \
  --host term.example.com \
  --identities alice@example.com:alice,bob@example.com:bob
```

Each Linux user must already exist and have a login shell (`sudo adduser alice`).

## How it works

- The app runs as **root** (system service `cloudflare-tmux.service`), so it can start processes as other users.
- For each request it verifies the Access JWT, maps the email to a user through `IDENTITIES`, and runs tmux with
  `setpriv --reuid <uid> --regid <gid> --init-groups --reset-env`. Each person gets their own tmux server,
  with no access to anyone else's sessions.
- It refuses to map `root` or any account with UID 0, and refuses accounts whose shell is `nologin` or `false`.
- The tunnel stays a user service of the account that ran the installer.

## Root-owned code

A root service must not run code that a normal user can edit. `scripts/install-system.sh` therefore:

1. copies `server.js`, `public/`, `node_modules/` and the `node` binary into **`/opt/cloudflare-tmux`**, owned by root and not writable by anyone else,
2. copies `~/.config/cloudflare-tmux/env` to **`/etc/cloudflare-tmux/env`** (directory `700`, file `600`), dropping `AUTH_DISABLED`,
3. installs `/etc/systemd/system/cloudflare-tmux.service` and **disables the single-user app service** so they don't both claim port 7681.

> [!IMPORTANT]
> Editing the checkout doesn't change what's running. After changing `IDENTITIES`, run both scripts again.
> After changing only code, `install-system.sh` is enough.
>
> ```bash
> scripts/cloudflare.sh term.example.com                     # updates the Access allow-list (asks for the API token)
> sudo NODE_BIN="$(command -v node)" scripts/install-system.sh                  # no token needed
> ```

`NODE_BIN` matters if you use nvm: `sudo` doesn't see your nvm `node`, so pass it explicitly.

## Adding or removing a person

1. `sudo adduser carol` (if needed).
2. Invite carol's Cloudflare account as a member of yours with **Minimal Account Access**
   ([Cloudflare login](../cloudflare/cloudflare-login.md)).
3. Add or remove `carol@example.com:carol` in `IDENTITIES` in `~/.config/cloudflare-tmux/env`.
4. Create a short-lived [API token](../cloudflare/api-token.md). The one from setup wasn't saved, and
   `cloudflare.sh` asks for it.
5. Run the two commands above, then delete the token. Removing an email takes them out of the Access policy
   **and** the app's own allow-list.

**Removing someone in a hurry?** Skip the token: remove their entry, then run only `install-system.sh`. The app
refuses them right away; tidy the Access policy with `cloudflare.sh` later.
