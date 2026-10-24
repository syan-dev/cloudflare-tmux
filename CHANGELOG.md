# Changelog

## Unreleased

- **The `cloudflare-tmux` command**, linked into `~/.local/bin` by the installer: `status` (is it online?),
  `people`, `add`, `remove`, `config`, `logs`, `restart` and `doctor`. One command to learn, whichever install
  you have. Output is colored on a terminal and plain when piped or with `NO_COLOR`.
  `people` shows, per person, whether the running app has them and when they last logged in, and `add` ends
  with a checklist of what was confirmed.
- **`cloudflare-tmux doctor`** checks the config, every mapped person, both services, boot settings, the local and
  public URLs and, with `CF_API_TOKEN`, the Access policy. It prints the fix next to anything that fails, and
  warns when a mapped Linux user is in a root-equivalent group such as `sudo` or `docker`.
- **One command to add or remove a person**: `cloudflare-tmux add carol@example.com carol` updates
  `IDENTITIES`, the Access policy and the running app. It offers to switch to the multi-user install when the
  Linux user isn't your own. `remove` locks someone out without a token. `list` shows who may log in.
- **Docs: a single [Add a person](docs/content/add-a-person.md) page** with the exact dashboard steps, the token
  recipe, the command, and what the new person sees. The multi-user install is no longer a choice to make up
  front: the installer asks when it's needed.
- **Clearer failures when adding people.** `cloudflare.sh` verifies the API token first and says when its
  start date is in the future, when it expired, or when its scope is wrong, instead of a traceback. The app
  refuses to start when `IDENTITIES` names a Linux user it can't serve without root, and `install.sh` offers
  the multi-user install in that case. A rejected person now sees a page that says what to ask the admin for.
- **Smaller API token**: *Access: Organizations, Identity Providers, and Groups* needs only **Read** (Edit
  just to create the Cloudflare login method the first time). The token is never saved:
  `install.sh` and `cloudflare.sh` ask for it when they need it and keep it in memory for that run. The
  quickstart now ends with deleting the token in Cloudflare, since nothing running uses it.
- **Security fixes**: a malformed `Origin` header on `/ws` could crash the server; the setup script no longer
  puts the API token or the tunnel token on command lines (visible to other local users in `ps`).
- **Security docs**: a step-by-step hardening checklist, what to do if an account or token is compromised, and
  a table of exactly which tasks need the Cloudflare API token (most don't).
- `ACCESS_SESSION` (default `24h`) sets how long a Cloudflare login lasts. It's saved in the config, so
  re-running `cloudflare.sh` no longer resets a shorter value.
- `scripts/install-cloudflared.sh [--restart]` installs or updates `cloudflared` with checksum checks and no API
  token (the tunnel runs with `--no-autoupdate`).
- `install.sh` verifies the SHA-256 of the downloaded `cloudflared` against the GitHub release and
  Cloudflare's release notes before installing it.
- **Login is now "Sign in with Cloudflare"**, restricted to members of your Cloudflare account. Google login
  and the Google OAuth setup are removed: invite each person as a member (Minimal Account Access) and map
  their Cloudflare account email in `IDENTITIES`.
- Optional **two-step code** in the app (`TOTP=required`): a 6-digit authenticator code after Cloudflare
  login, enrolled on the server with `scripts/totp.js`.
- **Copy and paste** in the terminal: tmux copies reach the browser clipboard (OSC 52, tmux 3.2+);
  Ctrl+Shift+C / Cmd+C copy a selection, Ctrl+Shift+V pastes.
- **Config moved out of the code** to `~/.config/cloudflare-tmux/env` (directory `700`, file `600`).
  An existing `.env` is moved there by the setup scripts and still read if left in place. The hostname and
  tunnel name are saved too, so re-running `install.sh` or `cloudflare.sh` reuses the same tunnel.

## 0.1.0 (2026-10-22)

First public release.

- Browser dashboard and terminal for tmux sessions (create, rename, kill, attach), with a mobile key bar.
- Cloudflare Access JWT verification on every HTTP request and WebSocket upgrade; email → Linux user mapping (`IDENTITIES`).
- `install.sh`: one-command interactive or unattended setup.
- `scripts/cloudflare.sh`: idempotent provisioning of the tunnel, Google login, Access app and policy, and DNS record.
- Single-user (systemd user services) and multi-user (root service with `setpriv`) modes.
- Documentation site built with Tailwind CSS.
