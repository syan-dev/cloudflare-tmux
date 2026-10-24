#!/usr/bin/env bash
# Add, remove or list the people who may log in. One command does the whole job: it updates IDENTITIES
# in the config, updates the Access policy on Cloudflare and restarts the app the right way for your install.
#
# Usage (./install.sh add|remove|list runs this script):
#   ./install.sh add <cloudflare-email> [linux-user]   default linux-user: you
#   ./install.sh remove <cloudflare-email>
#   ./install.sh list
#   Options: --yes (no questions; refuses instead of asking)
#
# add needs a Cloudflare API token: asked for, or $CF_API_TOKEN; never saved. remove and list don't.
# Mapping an email to a Linux user other than your own needs the multi-user (root) install. add offers to switch.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/config.sh
. "$APP_DIR/scripts/config.sh"

YES=0; ARGS=()
for a in "$@"; do case "$a" in -y|--yes) YES=1 ;; -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; *) ARGS+=("$a") ;; esac; done
CMD="${ARGS[0]:-}"
die() { echo "$*" >&2; exit 1; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }

# single: the app is your systemd user service and serves only your Linux user.
# multi:  the app is a root system service (scripts/install-system.sh) and serves any Linux user.
mode() { if [ -f /etc/systemd/system/cloudflare-tmux.service ]; then echo multi; else echo single; fi; }

identities() { env_get IDENTITIES | tr ',' '\n' | sed '/^[[:space:]]*$/d'; }
without() { identities | awk -v e="$1" 'BEGIN{IGNORECASE=1} { n=$0; sub(/:[^:]*$/, "", n); if (tolower(n) != e) print }' | paste -sd, -; }

restart_app() {
  if [ "$(mode)" = multi ]; then
    echo "Installing the root service (sudo may ask for your password)..."
    sudo NODE_BIN="$(command -v node)" ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/install-system.sh"
  else
    systemctl --user restart cloudflare-tmux.service
    systemctl --user --no-pager status cloudflare-tmux.service | grep -E "Active:" || true
  fi
}

case "$CMD" in
list)
  echo "Install: $(mode)-user   Config: $ENV_FILE"
  identities | awk -F: '{ u=$NF; sub(/:[^:]*$/, ""); printf "  %-40s -> %s\n", $0, u }'
  ;;

add)
  EMAIL="$(echo "${ARGS[1]:-}" | tr '[:upper:]' '[:lower:]')"
  LINUX_USER="${ARGS[2]:-$USER}"
  [[ "$EMAIL" == *@*.* ]] || die "usage: ./install.sh add <cloudflare-email> [linux-user]"
  [[ "$LINUX_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "Bad Linux user name: $LINUX_USER"
  [ "$LINUX_USER" != root ] || die "root may not be mapped."
  ENTRY="$(getent passwd "$LINUX_USER" || true)"
  [ -n "$ENTRY" ] || die "Linux user $LINUX_USER does not exist. Create it first: sudo adduser $LINUX_USER"
  [[ "$(echo "$ENTRY" | cut -d: -f7)" =~ (nologin|false)$ ]] && die "$LINUX_USER has no login shell: sudo chsh -s /bin/bash $LINUX_USER"
  [ -f "$ENV_FILE" ] || die "Missing $ENV_FILE. Run ./install.sh first."
  HOST="$(env_get PUBLIC_HOST)"
  [ -n "$HOST" ] || die "PUBLIC_HOST is not set in $ENV_FILE. Run ./install.sh first."

  SWITCH=0
  if [ "$(mode)" = single ] && [ "$LINUX_USER" != "$USER" ]; then
    echo "The app runs as your user service, so it can only serve Linux user '$USER'."
    echo "Serving '$LINUX_USER' needs the multi-user install: the app becomes a root system service"
    echo "that starts tmux as each mapped user. See docs/content/install/multi-user.md."
    if [ "$YES" -eq 1 ]; then die "Re-run without --yes to switch, or run: ./install.sh --multi-user"; fi
    read -r -p "Switch to the multi-user install now? It needs sudo. (y/n) [y]: " reply
    [ "${reply:-y}" = y ] || exit 1
    SWITCH=1
  fi

  echo "Before this works, $EMAIL must be a member of your Cloudflare account:"
  echo "  dash.cloudflare.com > Manage Account > Members > Invite, role 'Minimal Account Access', and they must accept."
  echo "  You can run this command before or after that."
  if [ -z "${CF_API_TOKEN:-}" ]; then
    echo "This command needs a Cloudflare API token, used once and never saved."
    echo "  Create one at https://dash.cloudflare.com/profile/api-tokens > Create Token > Create Custom Token, with:"
    echo "    Account · Cloudflare Tunnel · Edit"
    echo "    Account · Access: Apps and Policies · Edit"
    echo "    Account · Access: Organizations, Identity Providers, and Groups · Read"
    echo "    Zone · DNS · Edit, for the zone of $HOST"
    echo "  Set the TTL start date to today. Guide: https://syan-dev.github.io/cloudflare-tmux/cloudflare/api-token.html"
  fi
  echo

  OLD="$(env_get IDENTITIES)"
  REST="$(without "$EMAIL")"
  NEW="${REST:+$REST,}$EMAIL:$LINUX_USER"
  env_set IDENTITIES "$NEW"
  ok "IDENTITIES=$NEW"

  echo "Updating the Access policy on Cloudflare..."
  if ! "$APP_DIR/scripts/cloudflare.sh" "$HOST"; then
    env_set IDENTITIES "$OLD"
    die "Cloudflare update failed. The config was restored; nothing changed."
  fi

  if [ "$SWITCH" -eq 1 ]; then
    echo "Switching to the multi-user install (sudo may ask for your password)..."
    sudo NODE_BIN="$(command -v node)" ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/install-system.sh"
  else
    restart_app
  fi

  echo
  ok "$EMAIL can now log in at https://$HOST as Linux user $LINUX_USER."
  echo "  Still to do:"
  echo "  1. If $EMAIL isn't a member of your Cloudflare account yet, invite it:"
  echo "     dash.cloudflare.com > Manage Account > Members > Invite, role 'Minimal Account Access'."
  echo "     They must accept the invitation before Cloudflare lets them in."
  echo "  2. Delete the API token at https://dash.cloudflare.com/profile/api-tokens. Nothing running uses it."
  echo "  3. Send them the link https://$HOST and the short guide:"
  echo "     https://syan-dev.github.io/cloudflare-tmux/usage.html"
  ;;

remove)
  EMAIL="$(echo "${ARGS[1]:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$EMAIL" == *@* ]] || die "usage: ./install.sh remove <cloudflare-email>"
  identities | awk -F: '{ sub(/:[^:]*$/, ""); print tolower($0) }' | grep -qxF "$EMAIL" || die "$EMAIL is not in IDENTITIES."
  NEW="$(without "$EMAIL")"
  [ -n "$NEW" ] || die "Refusing to remove the last person. The app needs at least one."
  env_set IDENTITIES "$NEW"
  ok "IDENTITIES=$NEW"
  restart_app
  ok "$EMAIL is locked out. The app refuses them even with a valid Cloudflare login."
  if [ -n "${CF_API_TOKEN:-}" ]; then
    "$APP_DIR/scripts/cloudflare.sh" "$(env_get PUBLIC_HOST)"
  else
    echo "  Later, with a fresh API token, take them out of the Access policy too:"
    echo "    scripts/cloudflare.sh $(env_get PUBLIC_HOST)"
  fi
  echo "  Optional: remove them under Manage Account > Members, and run scripts/totp.js remove $EMAIL if you use the two-step code."
  ;;

*) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
