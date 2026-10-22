#!/usr/bin/env bash
# Installs cloudflare-tmux + its Cloudflare Tunnel as systemd user services.
# Run scripts/cloudflare.sh first (creates .env and ~/.cloudflared/cloudflare-tmux.token).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLOUDFLARED="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
NODE="$(command -v node)"
UNIT_DIR="$HOME/.config/systemd/user"

[ -x "$CLOUDFLARED" ] || { echo "cloudflared not found"; exit 1; }
[ -s "$HOME/.cloudflared/cloudflare-tmux.token" ] || { echo "Missing tunnel token; run scripts/cloudflare.sh"; exit 1; }
[ -f "$APP_DIR/.env" ] || { echo "Missing .env; run scripts/cloudflare.sh"; exit 1; }

cd "$APP_DIR"
npm ci --omit=dev --silent

mkdir -p "$UNIT_DIR"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__NODE__#$NODE#g" -e "s#__PATH__#$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin#g" \
  deploy/cloudflare-tmux.service > "$UNIT_DIR/cloudflare-tmux.service"
sed -e "s#__CLOUDFLARED__#$CLOUDFLARED#g" -e "s#__HOME__#$HOME#g" \
  deploy/cloudflared.service > "$UNIT_DIR/cloudflare-tmux-cloudflared.service"

systemctl --user daemon-reload
systemctl --user enable cloudflare-tmux.service cloudflare-tmux-cloudflared.service
systemctl --user restart cloudflare-tmux.service cloudflare-tmux-cloudflared.service

# Keep user services running after logout and across reboots.
loginctl show-user "$USER" -p Linger | grep -q yes || loginctl enable-linger "$USER" || \
  echo "Note: run 'sudo loginctl enable-linger $USER' so it starts at boot without logging in."

systemctl --user --no-pager status cloudflare-tmux.service cloudflare-tmux-cloudflared.service | grep -E "●|Active:"
