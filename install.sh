#!/usr/bin/env bash
# The one command for cloudflare-tmux. Safe to re-run.
#
# Usage: ./install.sh [--host term.example.com] [--identities you@gmail.com:you,...] [--multi-user] [--yes]
#        ./install.sh add|remove|list|doctor ...             same as the cloudflare-tmux command (see bin/)
#
# Setup checks prerequisites, asks for what it needs, provisions Cloudflare (scripts/cloudflare.sh) and
# installs the services (scripts/setup.sh, or scripts/install-system.sh when people map to other Linux users).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/config.sh
. "$APP_DIR/scripts/config.sh"
HOST_ARG="" IDENTITIES_ARG="" MULTI_USER=0 YES=0
dl="" token="" use_multi=""

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
case "${1:-}" in add|remove|list) exec "$APP_DIR/scripts/people.sh" "$@" ;; doctor) exec "$APP_DIR/scripts/doctor.sh" ;; esac
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
  ask dl "Download the official cloudflared binary to ~/.local/bin? (y/n)" y
  [ "$dl" = y ] || { echo "Install cloudflared, then re-run."; exit 1; }
  "$APP_DIR/scripts/install-cloudflared.sh"
fi

# ---------- 2. configuration ----------
bold "2/4 Configuration"
current_ids="$(env_get IDENTITIES)"
[ "$current_ids" = "you@example.com:youruser" ] && current_ids=""

HOST="$HOST_ARG"
[ -n "$HOST" ] || ask HOST "Hostname to serve on (a subdomain of a zone in your Cloudflare account)" "$(env_get PUBLIC_HOST)"
[[ "$HOST" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Invalid hostname: $HOST"; exit 1; }

IDENTITIES="$IDENTITIES_ARG"
if [ -z "$IDENTITIES" ]; then
  default_ids="$current_ids"
  [ -n "$default_ids" ] || { email="$(git config user.email 2>/dev/null || true)"; [ -n "$email" ] && default_ids="$email:$USER"; }
  ask IDENTITIES "Who may log in? cloudflare-account-email:linux-user[,more...]" "$default_ids"
fi
[ -n "$IDENTITIES" ] || { echo "IDENTITIES is required"; exit 1; }

# Validate before saving, so a typo never ends up in the config.
IFS=',' read -ra entries <<< "$IDENTITIES"
for e in "${entries[@]}"; do
  u="${e##*:}"
  [[ "$e" == *@*:?* ]] || { echo "  Bad entry '$e': expected email:linuxuser"; exit 1; }
  [ "$u" != root ] || { echo "  root may not be mapped."; exit 1; }
  getent passwd "$u" >/dev/null || { echo "  Linux user '$u' does not exist. Create it first: sudo adduser $u"; exit 1; }
done
if [ "$MULTI_USER" -eq 0 ]; then
  # The single-user app runs as you and can only serve you. Catch other mappings here, not at login time.
  others=()
  for e in "${entries[@]}"; do u="${e##*:}"; [ "$u" = "$USER" ] || others+=("${e%%:*} -> $u"); done
  if [ ${#others[@]} -gt 0 ]; then
    echo "  These people map to a Linux user other than '$USER': ${others[*]}"
    echo "  That needs the multi-user install: the app runs as a root service and starts tmux as each mapped user."
    if [ "$YES" -eq 1 ]; then echo "  Add --multi-user, or map everyone to $USER."; exit 1; fi
    ask use_multi "Use the multi-user install? It needs sudo. (y/n)" y
    [ "$use_multi" = y ] || { echo "Map everyone to $USER, or re-run with --multi-user."; exit 1; }
    MULTI_USER=1
  fi
fi
env_set IDENTITIES "$IDENTITIES"
ok "IDENTITIES=$IDENTITIES"

if [ -n "${CF_API_TOKEN:-}" ]; then
  ok "API token from \$CF_API_TOKEN"
else
  [ -n "$(env_get CF_ACCESS_AUD)" ] && echo "  The token from your first install wasn't saved. Create a new short-lived one."
  echo "  Create a token at https://dash.cloudflare.com/profile/api-tokens with:"
  echo "    Account · Cloudflare Tunnel · Edit"
  echo "    Account · Access: Apps and Policies · Edit"
  echo "    Account · Access: Organizations, Identity Providers, and Groups · Read"
  echo "    Zone · DNS · Edit (your zone)"
  ask_secret token "Paste the Cloudflare API token"
  [ -n "$token" ] || { echo "Token is required"; exit 1; }
  # Kept in memory for this run only; nothing is written to disk.
  export CF_API_TOKEN="$token"
  ok "API token accepted (not saved; you'll be asked again on a re-run)"
fi

echo "  Login is 'Sign in with Cloudflare': everyone in IDENTITIES needs their own Cloudflare account,"
echo "  invited as a member of yours (Manage Account > Members, role: Minimal Account Access)."
echo "  See https://syan-dev.github.io/cloudflare-tmux/cloudflare/cloudflare-login.html"

# ---------- 3. Cloudflare ----------
bold "3/4 Provisioning Cloudflare (tunnel, Cloudflare login, Access app, DNS)"
"$APP_DIR/scripts/cloudflare.sh" "$HOST"
unset CF_API_TOKEN token  # not needed by the services

# ---------- 4. services ----------
bold "4/4 Installing services"
if [ "$MULTI_USER" -eq 1 ]; then
  # The tunnel stays a user service; the app runs as root so it can serve several Linux users.
  "$APP_DIR/scripts/setup.sh"
  sudo NODE_BIN="$(command -v node)" ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/install-system.sh"
else
  "$APP_DIR/scripts/setup.sh"
fi

# The cloudflare-tmux command
mkdir -p "$HOME/.local/bin"
ln -sfn "$APP_DIR/bin/cloudflare-tmux" "$HOME/.local/bin/cloudflare-tmux"

echo
bold "Done. Open https://$HOST"
echo "  Then delete the API token at https://dash.cloudflare.com/profile/api-tokens; nothing running uses it."
echo
echo "  Day to day, use the cloudflare-tmux command:"
echo "    cloudflare-tmux status                 is it online?"
echo "    cloudflare-tmux add their@email.com    let someone log in"
echo "    cloudflare-tmux doctor                 check everything and print fixes"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "  (~/.local/bin is not on your PATH yet; log out and in, or run: export PATH=\"\$HOME/.local/bin:\$PATH\")" ;; esac
if [ "$MULTI_USER" -eq 1 ]; then
  echo "  Status: systemctl status cloudflare-tmux; systemctl --user status cloudflare-tmux-cloudflared"
  echo "  Logs:   journalctl -u cloudflare-tmux -f"
else
  echo "  Status: systemctl --user status cloudflare-tmux cloudflare-tmux-cloudflared"
  echo "  Logs:   journalctl --user -u cloudflare-tmux -f"
fi
