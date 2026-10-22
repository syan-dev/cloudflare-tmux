---
title: Prerequisites
description: What you need on Cloudflare and on your server before installing cloudflare-tmux.
---

# Prerequisites

## On Cloudflare

### A domain (zone) on Cloudflare

The hostname you serve on (for example `term.example.com`) must be in a zone that uses Cloudflare as its DNS.
Any plan works, including Free. The installer guesses the zone by dropping the first label of the hostname
(`term.example.com` → `example.com`). If that's wrong, for example `term.dev.example.co.uk`, set `ZONE_NAME=example.co.uk`.

### Zero Trust enabled

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Zero Trust**.
2. The first time, you'll be asked to pick a **team name**. This becomes your team domain:
   `<team>.cloudflareaccess.com`.
3. Choose the **Free** plan (up to 50 users). Cloudflare may ask for a payment method even for the Free plan.

> [!NOTE]
> The team domain is the address of the Cloudflare Access login page. The app checks that the JWTs it
> receives were issued by exactly this domain.

### A Cloudflare account for each person

Each person signs in with their own Cloudflare account (free) and must be a **member of your Cloudflare
account**. Invite them with the **Minimal Account Access** role. You'll map each account's email to a Linux
user. See [Cloudflare login](cloudflare/cloudflare-login.md).

## On your server

| Requirement | Why | Debian/Ubuntu | Fedora/RHEL |
|---|---|---|---|
| Linux with **systemd** | runs the app and tunnel as services | — | — |
| **tmux** (3.2+ recommended) | the sessions themselves; 3.2+ is needed to copy from tmux to your browser clipboard | `apt install tmux` | `dnf install tmux` |
| **Node.js 18+** and npm | runs the app | [nodejs.org](https://nodejs.org/) or [nvm](https://github.com/nvm-sh/nvm) | same |
| **make, g++** (and python3) | builds `node-pty`, the native PTY module | `apt install build-essential python3` | `dnf install gcc-c++ make python3` |
| **curl, python3** | used by the provisioning script | `apt install curl python3` | `dnf install curl python3` |
| **cloudflared** | the tunnel connector | the installer can download it | same |

Supported architectures for the automatic `cloudflared` download: `amd64`, `arm64`, `arm` (Raspberry Pi works).
Otherwise, install it from [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

> [!TIP]
> You don't need a public IP, port forwarding, or firewall rules. The tunnel connects outbound to
> Cloudflare on port 7844 (falling back to 443), so it works behind NAT, CGNAT, and most corporate networks.

## Single-user or multi-user?

- **Single-user** (default): the app runs as *you*, as a systemd **user** service. Only emails mapped to
  your own Linux user can open a terminal. No `sudo` needed (except possibly once for `loginctl enable-linger`).
- **Multi-user** (`--multi-user`): the app runs as **root** from a root-owned copy in `/opt/cloudflare-tmux`
  and starts each person's tmux as *their* Linux user. Use this when several people share a machine.
  See [Multi-user install](install/multi-user.md).
