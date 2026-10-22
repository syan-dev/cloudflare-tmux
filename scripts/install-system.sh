#!/usr/bin/env bash
# Installs cloudflare-tmux as a root system service so each mapped Cloudflare account email gets its own Linux user.
# Usage: sudo NODE_BIN="$(command -v node)" scripts/install-system.sh
# Config comes from the invoking user's ~/.config/cloudflare-tmux/env (or ENV_FILE); mapping is IDENTITIES.
# The app is copied to /opt/cloudflare-tmux (root-owned), so no user can modify code that runs as root.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OWNER="${SUDO_USER:-}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
"$NODE_BIN" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || \
  { echo "Need Node >= 18: pass NODE_BIN=\$(command -v node)"; exit 1; }
if [ -z "${ENV_FILE:-}" ]; then
  OWNER_HOME="$(getent passwd "${OWNER:-root}" | cut -d: -f6)"
  ENV_FILE="$OWNER_HOME/.config/cloudflare-tmux/env"
  [ -f "$ENV_FILE" ] || ENV_FILE="$SRC/.env"
fi
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (run scripts/cloudflare.sh first)"; exit 1; }
grep -q '^IDENTITIES=.' "$ENV_FILE" || { echo "Set IDENTITIES=email:linuxuser,... in $ENV_FILE"; exit 1; }

# 1. Root-owned copy of the app and node binary
install -d -m 755 -o root -g root /opt/cloudflare-tmux /opt/cloudflare-tmux/bin
rm -rf /opt/cloudflare-tmux/public /opt/cloudflare-tmux/node_modules /opt/cloudflare-tmux/lib
cp -r "$SRC/public" "$SRC/node_modules" "$SRC/lib" /opt/cloudflare-tmux/
install -m 644 "$SRC/server.js" "$SRC/package.json" /opt/cloudflare-tmux/
install -d -m 755 /opt/cloudflare-tmux/scripts
install -m 755 "$SRC/scripts/totp.js" /opt/cloudflare-tmux/scripts/
install -m 755 "$NODE_BIN" /opt/cloudflare-tmux/bin/node
chown -R root:root /opt/cloudflare-tmux
chmod -R go-w /opt/cloudflare-tmux

# 2. Config (root-only)
install -d -m 700 /etc/cloudflare-tmux
grep -v -E '^(AUTH_DISABLED)=' "$ENV_FILE" > /etc/cloudflare-tmux/env
chmod 600 /etc/cloudflare-tmux/env

# 3. systemd unit
install -m 644 "$SRC/deploy/cloudflare-tmux-system.service" /etc/systemd/system/cloudflare-tmux.service

# 4. Replace the single-user service (if any) with the system one
if [ -n "$OWNER" ]; then
  OWNER_UID="$(id -u "$OWNER")"
  sudo -u "$OWNER" XDG_RUNTIME_DIR="/run/user/$OWNER_UID" systemctl --user disable --now cloudflare-tmux.service 2>/dev/null || true
fi
systemctl daemon-reload
systemctl enable cloudflare-tmux.service
systemctl restart cloudflare-tmux.service
sleep 1
systemctl --no-pager status cloudflare-tmux.service | grep -E "Active:|listening" || true
journalctl -u cloudflare-tmux -n 3 --no-pager
