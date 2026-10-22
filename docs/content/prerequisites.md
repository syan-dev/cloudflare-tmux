---
title: Prerequisites
description: The three things you need before installing cloudflare-tmux, how to check you have them, and how to get them.
---

# Prerequisites

You need **three things** before running the installer. Each takes a few minutes, and all of them work on
free plans.

| | What | Why | Cost |
|---|---|---|---|
| <span class="badge">1</span> | [A domain on Cloudflare](#1-a-domain-on-cloudflare) | gives your terminal an address, like `term.example.com` | Cloudflare's Free plan is enough |
| <span class="badge">2</span> | [Zero Trust turned on](#2-zero-trust-turned-on) | shows a login page before anyone reaches your server | free for up to 50 people |
| <span class="badge">3</span> | [A Linux server](#3-a-linux-server) | where tmux and your sessions run | any machine you already have |

Here's where each one fits:

<div class="diagram not-prose">
  <div class="diagram-box">
    <p class="diagram-box-title">Your browser</p>
    <ul>
      <li>laptop or phone, anywhere</li>
      <li>you sign in with Cloudflare</li>
    </ul>
  </div>
  <div class="diagram-arrow"><b class="md:hidden">↓</b><b class="hidden md:block">→</b>HTTPS</div>
  <div class="diagram-box">
    <p class="diagram-box-title">Cloudflare</p>
    <ul>
      <li><span class="badge">1</span> your domain<br><code>term.example.com</code></li>
      <li><span class="badge">2</span> Zero Trust<br>the login page</li>
    </ul>
  </div>
  <div class="diagram-arrow"><b class="md:hidden">↑</b><b class="hidden md:block">←</b>tunnel, opened by your server</div>
  <div class="diagram-box">
    <p class="diagram-box-title"><span class="badge">3</span> Your Linux server</p>
    <ul>
      <li><code>cloudflared</code><br>the tunnel</li>
      <li><code>cloudflare-tmux</code><br>the web app</li>
      <li><code>tmux</code><br>your sessions</li>
    </ul>
  </div>
</div>
<p class="diagram-caption">Your server connects out to Cloudflare, so you don't open any ports or need a public IP.</p>

You don't create the tunnel, the login page settings or the DNS record yourself: the installer does that.
You only need the three things above.

## 1. A domain on Cloudflare

Cloudflare must be in charge of DNS for a domain you own (Cloudflare calls this a **zone**). The terminal goes on
a subdomain of it, such as `term.example.com`. You don't create that subdomain; the installer does.

**Check if you already have it.** Open the [Cloudflare dashboard](https://dash.cloudflare.com). Your domain should
be listed with the status **Active**. Or, from any terminal:

```bash
dig +short NS example.com
# should print two names ending in .ns.cloudflare.com
```

**If you don't have it yet:**

1. In the dashboard, choose **Add a domain**, type your domain, and pick the **Free** plan.
2. Cloudflare shows you two nameservers. At the company you bought the domain from (your registrar), replace the
   current nameservers with those two.
3. Wait for the status to turn **Active**. It's often a few minutes, at most a day.

Cloudflare's guide has the details: [Add a domain](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/).

> [!NOTE]
> The installer works out the zone by dropping the first part of your hostname: `term.example.com` → `example.com`.
> That's wrong for hostnames like `term.dev.example.co.uk`. In that case, set `ZONE_NAME=example.co.uk` when you
> run it.

## 2. Zero Trust turned on

Zero Trust is the Cloudflare product that puts a login page in front of your terminal (its login part is
called **Cloudflare Access**). You only turn it on once.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **Zero Trust** in the left sidebar.
2. Pick a **team name**, for example your name or your company's. It becomes the address of your login page:
   `<team>.cloudflareaccess.com`.
3. Choose the **Free** plan. Cloudflare may ask for a payment method even for Free; you won't be charged.

**Already done?** If opening **Zero Trust** takes you straight to its dashboard, without asking for a team name,
you're set.

## 3. A Linux server

Any Linux machine with **systemd** that stays switched on: a cloud VPS, a home server, or a Raspberry Pi.
It doesn't need a public IP address.

Install these packages:

```bash
# Debian / Ubuntu
sudo apt install tmux nodejs npm build-essential python3 curl

# Fedora / RHEL
sudo dnf install tmux nodejs npm gcc-c++ make python3 curl
```

Then check that Node.js is version **18 or newer**:

```bash
node -v    # v18.x or higher
```

If it's older (Ubuntu 22.04 ships v12), install a current one with [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# open a new terminal, then:
nvm install --lts
```

<details>
<summary>What each package is for</summary>

| Package | Used for |
|---|---|
| **tmux** | your sessions. Version 3.2 or newer lets you copy from tmux to your browser's clipboard. |
| **Node.js 18+** and npm | runs the web app |
| **make, g++, python3** | build `node-pty`, the part of the app that talks to the terminal |
| **curl, python3** | used by the setup script to talk to Cloudflare |
| **cloudflared** | keeps the tunnel to Cloudflare open. No need to install it: the installer offers to download it. |

</details>

> [!TIP]
> Not sure you have everything? Just run the installer. Its first step checks each item and, if something is
> missing, prints the exact command to install it.

The installer downloads `cloudflared` for `amd64`, `arm64` and `arm` (Raspberry Pi), checks its SHA-256 against
GitHub and Cloudflare's release notes, and puts it in `~/.local/bin`. On other machines, install it from
[Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

## Who logs in

To start, just **you**, with the Cloudflare account you used above. Nothing else to set up.

Other people can be added later. Each needs their own free Cloudflare account, invited to yours as a member
with the **Minimal Account Access** role. See [Cloudflare login](cloudflare/cloudflare-login.md).

## Single-user or multi-user?

| Who uses it | Install | What happens |
|---|---|---|
| Just you, or people who share your Linux account | **single-user** (the default) | The app runs as you. No `sudo`, except perhaps once for `loginctl enable-linger`. |
| Several people, each with **their own** Linux account | `--multi-user` | The app runs as root and opens each person's tmux as *their* Linux user. See [Multi-user install](install/multi-user.md). |

## Ready?

- [ ] Your domain shows **Active** in the Cloudflare dashboard
- [ ] **Zero Trust** opens without asking for a team name
- [ ] `tmux -V` works and `node -v` prints v18 or higher

Then go to the [Quickstart](quickstart.md).
