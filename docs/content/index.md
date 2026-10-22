---
title: Overview
description: Persistent tmux sessions in your browser, served through a Cloudflare Tunnel and protected by Cloudflare Access.
---

# Overview

**cloudflare-tmux** gives you a terminal on your own Linux machine from any browser, including your phone.
It's a small Node.js app in front of tmux, reachable through a Cloudflare Tunnel and protected by Cloudflare Access.

- **No open ports.** Your server connects out to Cloudflare. You need no port forwarding, public IP or firewall changes.
- **Sign in with your Cloudflare account.** Cloudflare Access shows a login page first. Only the people you list get
  through. You can add a [two-step code](two-step.md) on top.
- **Sessions keep running.** Every terminal is a real tmux session. Close the tab, lose Wi-Fi or switch devices, and
  your programs carry on.
- **The same sessions on the server.** `tmux ls` and `tmux attach` show what you see in the browser.
- **Built for phones.** A key bar adds Esc, Tab, Ctrl, the tmux prefix and arrow keys on touch screens.
- **Multi-user.** Each Cloudflare account maps to one Linux user. Terminals run as that user, never as root.
- **One command to set up.** `./install.sh` creates everything on Cloudflare and installs services that start on boot.

![A tmux session open in the browser](assets/img/terminal.png)

![The session dashboard: create, open, rename and kill sessions](assets/img/dashboard.png)

## How it works

```text
browser ──HTTPS──▶ Cloudflare Access (login page) ──▶ tunnel ──▶ your server ──▶ tmux
```

1. You open `https://term.example.com`. Cloudflare Access asks you to sign in with your Cloudflare account.
2. If you're on the list, Cloudflare forwards the request through the tunnel to your server. The tunnel is an
   outbound connection, so nothing on your server listens on the internet.
3. The app checks the login a second time, works out which Linux user you are, and shows your tmux sessions.
4. Opening a session attaches a tmux client and streams it to your browser. Closing the tab detaches that
   client. The session and everything running in it keep going.

The [security model](security.md) describes each check in detail.

## How it compares

| | cloudflare-tmux | ttyd / gotty | SSH + port forward | Cloudflare browser SSH |
|---|---|---|---|---|
| Open inbound ports | none | yes, or your own tunnel | yes | none |
| Login | Cloudflare account, checked twice | basic auth or your own | keys or passwords | Cloudflare Access |
| Sessions survive closing the tab | yes | only with tmux | only with tmux | only with tmux |
| Session dashboard | yes | no | no | no |
| Mobile key bar | yes | no | depends on the app | no |
| Needs an SSH server | no | no | yes | yes |

## Next steps

> [!TIP]
> Most people are up and running in about five minutes with the [Quickstart](quickstart.md).

- [Prerequisites](prerequisites.md): what you need before you start.
- [Security model](security.md): why it's safe to put a shell behind a URL.
- [What gets created in Cloudflare](cloudflare/what-gets-created.md): every object the installer touches.
