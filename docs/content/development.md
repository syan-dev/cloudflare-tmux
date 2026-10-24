---
title: Development
description: Run cloudflare-tmux locally without Cloudflare, run the tests, and work on the docs site.
---

# Development

## Run locally without Cloudflare

```bash
npm install
AUTH_DISABLED=1 node server.js
# → http://127.0.0.1:7681, acting as your own user
```

`AUTH_DISABLED=1` skips the Access check and is refused when running as root. Never set it on a server that is reachable through the tunnel.

## Tests

```bash
npm test
```

`scripts/smoke-test.js` starts the server twice:

1. with auth disabled: creates a session over the API, checks that invalid names and cross-origin
   requests (HTTP and WebSocket) are refused, attaches through the WebSocket, disconnects, checks that the
   session survived, then kills it.
2. with auth enabled: checks that requests and WebSocket upgrades without a valid Access JWT get a 401.

Shell scripts are checked with `shellcheck -x install.sh bin/cloudflare-tmux scripts/*.sh`. CI runs both.

## Project layout

```text
server.js                 Express + WebSocket server: auth, tmux API, PTY bridge
public/                   the web UI (dashboard, xterm.js terminal, mobile keys)
install.sh                one-command interactive setup
bin/cloudflare-tmux       the day-to-day command: status, people, add, remove, config, logs, restart, doctor
scripts/cloudflare.sh     Cloudflare API provisioning (tunnel, IdP, Access, DNS)
scripts/people.sh         add/remove/list people (behind cloudflare-tmux add|remove|people)
scripts/doctor.sh         health checks with fixes (behind cloudflare-tmux doctor)
scripts/setup.sh          systemd user services (single-user)
scripts/install-system.sh root system service (multi-user)
scripts/totp.js           enroll authenticators for the two-step code
scripts/smoke-test.js     end-to-end tests
deploy/*.service          systemd unit templates
docs/                     this documentation site (Tailwind)
```

## The WebSocket protocol

`GET /ws?session=<name>&cols=<n>&rows=<n>` (same-origin, authenticated) attaches `tmux new-session -A -s <name>`.

- Server → client: terminal output (text frames).
- Client → server: keyboard input as text frames. Control messages are JSON prefixed with `\x00`, currently
  only `{"type":"resize","cols":120,"rows":40}`.

HTTP API (all under Access):

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/me` | | `{ email, user, local }` |
| GET | `/api/sessions` | | `[{ name, windows, attached, activity, created }]` |
| POST | `/api/sessions` | `{ name }` | 201 |
| POST | `/api/sessions/:name/rename` | `{ name }` | 200 |
| DELETE | `/api/sessions/:name` | | 204 |

## Docs site

The site is plain Markdown in `docs/content/`, built into static HTML with a small Node script and styled with [Tailwind CSS](https://tailwindcss.com/).

```bash
cd docs
npm install
npm run build        # → docs/dist
npm run dev          # build + serve locally
```

- Navigation order: the `NAV` list in `docs/build.mjs`. Each page has `title:` and `description:` front matter.
- Callouts: GitHub syntax, for example `> [!TIP]`, `> [!WARNING]`.
- Link other pages by their `.md` path; links are rewritten to `.html`.
- Pushing to `main` deploys to GitHub Pages through `.github/workflows/docs.yml`.
