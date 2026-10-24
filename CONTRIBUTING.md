# Contributing

Thanks for helping! Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/syan-dev/cloudflare-tmux.git
cd cloudflare-tmux
npm install
AUTH_DISABLED=1 node server.js   # http://127.0.0.1:7681
```

## Before opening a PR

- `npm test` passes (needs `tmux` installed).
- `shellcheck -x install.sh bin/cloudflare-tmux scripts/*.sh` is clean.
- Update the docs in `docs/content/` if behavior or setup changes. Preview them with `cd docs && npm install && npm run dev`.
- Keep the security properties intact: listen on loopback only, verify the Access JWT on every request and
  WebSocket, never allow mapping root, and pass arguments to tmux without a shell.

## Style

Plain Node.js (CommonJS) and Bash with `set -euo pipefail`; no build step for the app. Keep dependencies minimal.
