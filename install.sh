#!/usr/bin/env bash
# One-command setup for cloudflare-tmux: checks prerequisites, asks for what it needs,
# provisions Cloudflare (scripts/cloudflare.sh) and installs the services (scripts/setup.sh,
# or scripts/install-system.sh with --multi-user). Safe to re-run.
#
# Usage: ./install.sh [--host term.example.com] [--identities you@gmail.com:you,...]
#                     [--multi-user] [--yes]
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$APP_DIR/.env"
TOKEN_FILE="$HOME/.cloudflare-token"
HOST_ARG="" IDENTITIES_ARG="" MULTI_USER=0 YES=0
dl="" token=""

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST_ARG="${2:?--host needs a value}"; shift 2 ;;
    --identities) IDENTITIES_ARG="${2:?--identities needs a value}"; shift 2 ;;
    --multi-user) MULTI_USER=1; shift ;;
    -y|--yes) YES=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1"; usage 1 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
ask() {  # ask VAR "Prompt" [default]
  local reply
  if [ "$YES" -eq 1 ] && [ -n "${3:-}" ]; then printf -v "$1" '%s' "$3"; return; fi
  [ "$YES" -eq 1 ] && { echo "Missing value for: $2 (pass it as a flag)"; exit 1; }
  read -r -p "$2${3:+ [$3]}: " reply
  printf -v "$1" '%s' "${reply:-${3:-}}"
}
ask_secret() {  # ask_secret VAR "Prompt"
  [ "$YES" -eq 1 ] && { echo "Missing secret: $2"; exit 1; }
  local reply; read -r -s -p "$2: " reply; echo; printf -v "$1" '%s' "$reply"
}

# ---------- 1. prerequisites ----------
bold "1/4 Checking prerequisites"
missing=()
if [ "$(uname -s)" = Linux ]; then ok "Linux"; else bad "Linux is required"; exit 1; fi
if command -v systemctl >/dev/null; then ok "systemd"; else bad "systemd is required"; exit 1; fi
for bin in tmux python3 curl make g++; do
  if command -v "$bin" >/dev/null; then ok "$bin"; else bad "$bin"; missing+=("$bin"); fi
done
if command -v node >/dev/null && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)'; then
  ok "node $(node -v)"
else
  bad "Node.js >= 18 (https://nodejs.org or nvm)"; missing+=(node)
fi
if [ ${#missing[@]} -gt 0 ]; then
  pkgs="${missing[*]}"; pkgs="${pkgs//node/nodejs npm}"
  echo
  echo "Install the missing packages, then re-run ./install.sh:"
  command -v apt-get >/dev/null && echo "  sudo apt-get install -y ${pkgs//g++/build-essential}"
  command -v dnf >/dev/null && echo "  sudo dnf install -y ${pkgs//g++/gcc-c++}"
  exit 1
fi

CLOUDFLARED="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
if [ -x "$CLOUDFLARED" ]; then
  ok "cloudflared ($CLOUDFLARED)"
else
  bad "cloudflared"
  case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=arm ;; *) arch="" ;; esac
  [ -n "$arch" ] || { echo "Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
  ask dl "Download the official cloudflared binary to ~/.local/bin? (y/n)" y
  [ "$dl" = y ] || { echo "Install cloudflared, then re-run."; exit 1; }
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -o "$HOME/.local/bin/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
  chmod +x "$HOME/.local/bin/cloudflared"
  ok "cloudflared installed to ~/.local/bin/cloudflared"
fi

# ---------- 2. configuration ----------
bold "2/4 Configuration"
[ -f "$ENV_FILE" ] || cp "$APP_DIR/.env.example" "$ENV_FILE"
chmod 600 "$ENV_FILE"
current_ids="$(sed -n 's/^IDENTITIES=//p' "$ENV_FILE" | tail -1)"
[ "$current_ids" = "you@example.com:youruser" ] && current_ids=""

HOST="$HOST_ARG"
[ -n "$HOST" ] || ask HOST "Hostname to serve on (a subdomain of a zone in your Cloudflare account)" "${CF_TMUX_HOST:-}"
[[ "$HOST" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Invalid hostname: $HOST"; exit 1; }

IDENTITIES="$IDENTITIES_ARG"
if [ -z "$IDENTITIES" ]; then
  default_ids="$current_ids"
  [ -n "$default_ids" ] || { email="$(git config user.email 2>/dev/null || true)"; [ -n "$email" ] && default_ids="$email:$USER"; }
  ask IDENTITIES "Who may log in? cloudflare-account-email:linux-user[,more...]" "$default_ids"
fi
[ -n "$IDENTITIES" ] || { echo "IDENTITIES is required"; exit 1; }
if grep -q '^IDENTITIES=' "$ENV_FILE"; then
  python3 - "$ENV_FILE" "$IDENTITIES" <<'PY'
import sys
path, ids = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
open(path, "w").write("\n".join(f"IDENTITIES={ids}" if l.startswith("IDENTITIES=") else l for l in lines) + "\n")
PY
else
  echo "IDENTITIES=$IDENTITIES" >> "$ENV_FILE"
fi
ok "IDENTITIES=$IDENTITIES"

if [ "$MULTI_USER" -eq 0 ]; then
  IFS=',' read -ra entries <<< "$IDENTITIES"
  for e in "${entries[@]}"; do
    u="${e##*:}"
    [ "$u" = "$USER" ] || echo "  note: ${e%%:*} maps to '$u', not '$USER' — that needs --multi-user."
  done
fi

if [ -n "${CF_API_TOKEN:-}" ]; then
  ok "API token from \$CF_API_TOKEN"
elif [ -s "$TOKEN_FILE" ]; then
  ok "API token from $TOKEN_FILE"
else
  echo "  Create a token at https://dash.cloudflare.com/profile/api-tokens with:"
  echo "    Account · Cloudflare Tunnel · Edit"
  echo "    Account · Access: Apps and Policies · Edit"
  echo "    Account · Access: Organizations, Identity Providers, and Groups · Edit"
  echo "    Zone · DNS · Edit (your zone)"
  ask_secret token "Paste the Cloudflare API token"
  [ -n "$token" ] || { echo "Token is required"; exit 1; }
  (umask 077; printf '%s\n' "$token" > "$TOKEN_FILE")
  ok "saved to $TOKEN_FILE"
fi

echo "  Login is 'Sign in with Cloudflare': everyone in IDENTITIES needs their own Cloudflare account,"
echo "  invited as a member of yours (Manage Account > Members, role: Minimal Account Access)."
echo "  See https://syan-dev.github.io/cloudflare-tmux/cloudflare/cloudflare-login.html"

# ---------- 3. Cloudflare ----------
bold "3/4 Provisioning Cloudflare (tunnel, Cloudflare login, Access app, DNS)"
"$APP_DIR/scripts/cloudflare.sh" "$HOST"

# ---------- 4. services ----------
bold "4/4 Installing services"
if [ "$MULTI_USER" -eq 1 ]; then
  # The tunnel stays a user service; the app runs as root so it can serve several Linux users.
  "$APP_DIR/scripts/setup.sh"
  sudo NODE_BIN="$(command -v node)" "$APP_DIR/scripts/install-system.sh"
else
  "$APP_DIR/scripts/setup.sh"
fi

echo
bold "Done. Open https://$HOST"
if [ "$MULTI_USER" -eq 1 ]; then
  echo "  Status: systemctl status cloudflare-tmux; systemctl --user status cloudflare-tmux-cloudflared"
  echo "  Logs:   journalctl -u cloudflare-tmux -f"
else
  echo "  Status: systemctl --user status cloudflare-tmux cloudflare-tmux-cloudflared"
  echo "  Logs:   journalctl --user -u cloudflare-tmux -f"
fi
