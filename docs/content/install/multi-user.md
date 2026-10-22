---
title: Multi-user install
description: Serve several people from one machine, each Cloudflare account mapped to its own Linux user.
---

# Multi-user install

Use this when several people share a machine and each should get **their own Linux user**: their own files,
permissions and tmux sessions.

```bash
./install.sh --multi-user \
  --host term.example.com \
  --identities alice@example.com:alice,bob@example.com:bob
```

Each Linux user must already exist and have a login shell. Create one with `sudo adduser alice`.

## How it works

- The app runs as **root**, as the system service `cloudflare-tmux.service`, so it can start processes as
  other users.
- For each request it checks the login, maps the email to a Linux user through `IDENTITIES`, and starts tmux
  as that user with `setpriv`. Each person gets their own tmux server and can't reach anyone else's sessions.
- It refuses to map `root`, any account with UID 0, and any account whose shell is `nologin` or `false`.
- The tunnel stays a user service of the account that ran the installer.

## Root-owned code

A root service must not run code that a normal user can edit. So `scripts/install-system.sh`:

1. copies `server.js`, `public/`, `node_modules/` and the `node` binary to `/opt/cloudflare-tmux`, owned by
   root and writable by nobody else;
2. copies `~/.config/cloudflare-tmux/env` to `/etc/cloudflare-tmux/env`, directory `700` and file `600`,
   dropping `AUTH_DISABLED`;
3. installs `/etc/systemd/system/cloudflare-tmux.service` and **disables the single-user app service**, so
   they don't both claim port 7681.

## After you change the config or the code

Editing the checkout or the config file doesn't change what's running. Run:

```bash
scripts/cloudflare.sh term.example.com                        # only if IDENTITIES changed; asks for an API token
sudo NODE_BIN="$(command -v node)" scripts/install-system.sh  # always; no token needed
```

`NODE_BIN` matters if you use nvm: `sudo` doesn't see your nvm `node`, so pass it explicitly.

## Add or remove a person

Follow [Cloudflare login](../cloudflare/cloudflare-login.md), with two differences:

- Create the Linux user first: `sudo adduser carol`.
- Run `install-system.sh` as above instead of `scripts/setup.sh` or a restart.

To lock someone out in a hurry, remove their entry from `IDENTITIES` and run only `install-system.sh`. The app
refuses them right away. Tidy the Access policy with `cloudflare.sh` later.
