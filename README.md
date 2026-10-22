<h1 align="center">cloudflare-tmux</h1>

<p align="center">
  <b>Your tmux sessions, in any browser.</b><br>
  Served through a <b>Cloudflare Tunnel</b> (no open ports) and protected by <b>Cloudflare Zero Trust Access</b> (Cloudflare account login).
</p>

<p align="center">
  <a href="https://syan-dev.github.io/cloudflare-tmux/"><b>📖 Documentation</b></a> ·
  <a href="https://syan-dev.github.io/cloudflare-tmux/quickstart.html">Quickstart</a> ·
  <a href="https://syan-dev.github.io/cloudflare-tmux/security.html">Security model</a>
</p>

<p align="center">
  <a href="https://github.com/syan-dev/cloudflare-tmux/actions/workflows/ci.yml"><img src="https://github.com/syan-dev/cloudflare-tmux/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

---

<p align="center">
  <img src="docs/public/assets/img/terminal.png" alt="A tmux session open in the browser" width="49%">
  <img src="docs/public/assets/img/dashboard.png" alt="The session dashboard" width="49%">
</p>

- **No open ports.** The app listens on `127.0.0.1`; `cloudflared` connects out to Cloudflare. It works behind NAT and CGNAT.
- **Sign in with Cloudflare.** Access only lets in members of your Cloudflare account whose emails you list, and the app **verifies the Access JWT again** on every request.
- **Optional two-step code.** The app can also ask for a 6-digit authenticator code after Cloudflare login.
- **Sessions persist.** It's real tmux: close the tab, switch devices, and your programs keep running. `tmux attach` works locally too.
- **Mobile-friendly.** A key bar adds Esc, Tab, Ctrl, the tmux prefix and arrow keys on touch screens.
- **Multi-user.** Each Cloudflare account email maps to one Linux user (never root); terminals run as that user.
- **One command.** `./install.sh` creates the tunnel, Cloudflare login, Access app and DNS record through the Cloudflare API, then installs systemd services.

```text
browser ──HTTPS──▶ Cloudflare Access (Cloudflare login) ──▶ Tunnel ──▶ cloudflared ──▶ 127.0.0.1:7681 cloudflare-tmux
                                                              JWT check · email → Linux user ──▶ tmux
```

## Quickstart

You need a domain on Cloudflare, [Zero Trust](https://one.dash.cloudflare.com/) enabled (the Free plan is fine), and a Linux server with systemd, tmux and Node.js 18+.

```bash
git clone https://github.com/syan-dev/cloudflare-tmux.git
cd cloudflare-tmux
./install.sh
```

The installer asks for a hostname (for example `term.example.com`), who may log in (`you@example.com:youruser`: a Cloudflare account email, then a Linux user), and a
[Cloudflare API token](https://syan-dev.github.io/cloudflare-tmux/cloudflare/api-token.html). Other people sign in with their own Cloudflare
account: [invite them as members](https://syan-dev.github.io/cloudflare-tmux/cloudflare/cloudflare-login.html) with Minimal Account Access.
Then open `https://term.example.com`.

Without prompts:

```bash
CF_API_TOKEN=... ./install.sh --yes --host term.example.com --identities you@example.com:$USER
```

Several people with their own Linux users: add `--multi-user`. See the [docs](https://syan-dev.github.io/cloudflare-tmux/install/multi-user.html).

## Documentation

Full docs: **https://syan-dev.github.io/cloudflare-tmux/**

| | |
|---|---|
| [Prerequisites](https://syan-dev.github.io/cloudflare-tmux/prerequisites.html) | Cloudflare and server requirements |
| [What gets created](https://syan-dev.github.io/cloudflare-tmux/cloudflare/what-gets-created.html) | every Cloudflare object, and how to do it by hand |
| [Configuration](https://syan-dev.github.io/cloudflare-tmux/configuration.html) | env vars, flags, files |
| [Cloudflare login](https://syan-dev.github.io/cloudflare-tmux/cloudflare/cloudflare-login.html) | invite members, map emails, 2FA |
| [Security model](https://syan-dev.github.io/cloudflare-tmux/security.html) | defense in depth, hardening |
| [Two-step login](https://syan-dev.github.io/cloudflare-tmux/two-step.html) | optional authenticator code in the app |
| [Operations](https://syan-dev.github.io/cloudflare-tmux/operations.html) | logs, updates, uninstall |
| [Troubleshooting](https://syan-dev.github.io/cloudflare-tmux/troubleshooting.html) | common errors and fixes |

## Development

```bash
npm install
AUTH_DISABLED=1 node server.js   # http://127.0.0.1:7681, no Cloudflare needed
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Not affiliated with or endorsed by Cloudflare, Inc.
