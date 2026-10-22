# Changelog

## Unreleased

- **Login is now "Sign in with Cloudflare"**, restricted to members of your Cloudflare account. Google login
  and the Google OAuth setup are removed: invite each person as a member (Minimal Account Access) and map
  their Cloudflare account email in `IDENTITIES`.
- Optional **two-step code** in the app (`TOTP=required`): a 6-digit authenticator code after Cloudflare
  login, enrolled on the server with `scripts/totp.js`.
- **Copy and paste** in the terminal: tmux copies reach the browser clipboard (OSC 52, tmux 3.2+);
  Ctrl+Shift+C / Cmd+C copy a selection, Ctrl+Shift+V pastes.

## 0.1.0 (2026-10-22)

First public release.

- Browser dashboard and terminal for tmux sessions (create, rename, kill, attach), with a mobile key bar.
- Cloudflare Access JWT verification on every HTTP request and WebSocket upgrade; email → Linux user mapping (`IDENTITIES`).
- `install.sh`: one-command interactive or unattended setup.
- `scripts/cloudflare.sh`: idempotent provisioning of the tunnel, Google login, Access app and policy, and DNS record.
- Single-user (systemd user services) and multi-user (root service with `setpriv`) modes.
- Documentation site built with Tailwind CSS.
