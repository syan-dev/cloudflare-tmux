---
title: Prerequisites
description: The three things you need before installing cloudflare-tmux.
---

# Prerequisites

You need three things, all on free plans:

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

## 1. A domain on Cloudflare

Your domain must use Cloudflare for DNS. The installer adds the `term.` subdomain itself.

1. [Create a Cloudflare account](https://developers.cloudflare.com/fundamentals/account/create-account/) (free).
2. [Add your domain](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/) on the Free plan.
3. [Change its nameservers](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) at your registrar to the two Cloudflare gives you.

Done when the domain shows **Active** in the [dashboard](https://dash.cloudflare.com)
([what the statuses mean](https://developers.cloudflare.com/dns/zone-setups/reference/domain-status/)).

## 2. Zero Trust turned on

Zero Trust provides the login page. Follow
[Get started with Cloudflare Zero Trust](https://developers.cloudflare.com/cloudflare-one/setup/): pick a
**team name** and the **Free** plan. That's all; the installer sets up the rest.

Done when **Zero Trust** in the dashboard opens without asking for a team name.

## 3. A Linux server

Any always-on Linux machine with systemd: a VPS, a home server, a Raspberry Pi. No public IP needed.

```bash
sudo apt install tmux nodejs npm build-essential python3 curl   # Debian / Ubuntu
sudo dnf install tmux nodejs npm gcc-c++ make python3 curl      # Fedora / RHEL
```

Done when `node -v` prints **v18** or newer (if not, [install Node.js](https://nodejs.org/en/download)).
The installer checks the rest and downloads `cloudflared` for you.

## Who logs in

Start with just yourself. To add people later, see [Cloudflare login](cloudflare/cloudflare-login.md). If each
person needs their own Linux account, use the [multi-user install](install/multi-user.md).

Ready? Go to the [Quickstart](quickstart.md).
