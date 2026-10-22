---
title: Overview
description: Persistent tmux sessions in your browser, served through a Cloudflare Tunnel and protected by Cloudflare Zero Trust Access with Google login.
---

# Overview

**cloudflare-tmux** gives you a terminal on your own Linux machine from any browser, including your phone.
It's a small Node.js app in front of **tmux**, published through a **Cloudflare Tunnel** and protected by
**Cloudflare Zero Trust Access**.

- **No open ports.** The app listens on `127.0.0.1` only. `cloudflared` makes an outbound connection to
  Cloudflare, so you need no port forwarding, public IP, or firewall changes.
- **Sign in with Google.** Cloudflare Access sits in front of the app and only lets in the Google accounts you list.
- **Sessions persist.** Every terminal is a real tmux session. Close the tab, lose your connection, or switch
  devices, and your programs keep running. Reopen the page and you're back where you left off.
- **The same sessions locally.** `tmux ls` and `tmux attach -t <name>` on the server show the same sessions you use in the browser.
- **Built for mobile.** A key bar adds Esc, Tab, Ctrl, the tmux prefix and arrow keys on touch screens.
- **Multi-user.** Each Google account maps to exactly one Linux user, and terminals run as that user. `root` can never be mapped.
- **One-command setup.** `./install.sh` creates the tunnel, the Google login, the Access application and
  the DNS record through the Cloudflare API, then installs systemd services that start on boot.

![A tmux session open in the browser](assets/img/terminal.png)

![The session dashboard: create, open, rename and kill sessions](assets/img/dashboard.png)

## How it works

```text
 browser ──HTTPS──▶ Cloudflare edge ──▶ Access (Google login, email allow-list)
                                          │
                                          ▼  Tunnel (outbound connection from your server)
                     your server: cloudflared ──▶ 127.0.0.1:7681 cloudflare-tmux
                                                     │ verifies the Access JWT again
                                                     │ email → Linux user (IDENTITIES)
                                                     ▼
                                                  tmux (running as that user)
```

1. You open `https://term.example.com`. Cloudflare Access redirects you to Google to sign in.
2. If your email is on the allow-list, Access sets a signed `CF_Authorization` cookie (a JWT) and forwards
   the request through the tunnel to `cloudflared` on your server.
3. `cloudflared` passes it to the app on `127.0.0.1:7681`. The app **verifies the JWT itself** (signature,
   issuer, audience, email) and looks up which Linux user that email maps to.
4. The dashboard lists that user's tmux sessions. Opening one starts a WebSocket that attaches a
   `tmux new-session -A` client in a pseudo-terminal, rendered in the browser by [xterm.js](https://xtermjs.org/).
5. Closing the tab kills only that tmux *client*. The session and everything running in it stay alive.

## How it compares

| | cloudflare-tmux | ttyd / gotty | SSH + port forward | Cloudflare browser SSH |
|---|---|---|---|---|
| Open inbound ports | none | yes (or DIY tunnel) | yes | none |
| Login | Google via Access + in-app JWT check | basic auth / DIY | keys / passwords | Access |
| Sessions survive closing the tab | yes (tmux) | no, unless you wrap tmux yourself | no, unless you use tmux | no, unless you use tmux |
| Session dashboard | yes | no | no | no |
| Mobile key bar | yes | no | depends on the app | no |
| Needs an SSH server | no | no | yes | yes |

## Next steps

> [!TIP]
> Most people are up and running in about five minutes with the [Quickstart](quickstart.md).

- [Prerequisites](prerequisites.md): what you need before you start.
- [Security model](security.md): why it's safe to put a shell behind a URL.
- [What gets created in Cloudflare](cloudflare/what-gets-created.md): every object the setup script touches.
