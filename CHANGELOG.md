# Changelog

## 0.1.0 (2026-10-22)

First public release.

- Browser dashboard and terminal for tmux sessions (create, rename, kill, attach), with a mobile key bar.
- Cloudflare Access JWT verification on every HTTP request and WebSocket upgrade; email → Linux user mapping (`IDENTITIES`).
- `install.sh`: one-command interactive or unattended setup.
- `scripts/cloudflare.sh`: idempotent provisioning of the tunnel, Google login, Access app and policy, and DNS record.
- Single-user (systemd user services) and multi-user (root service with `setpriv`) modes.
- Documentation site built with Tailwind CSS.
