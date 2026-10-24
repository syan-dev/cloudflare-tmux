#!/usr/bin/env bash
# Add, remove or list the people who may log in. One command does the whole job: it updates IDENTITIES
# in the config, updates the Access policy on Cloudflare and restarts the app the right way for your install.
#
# Usage (cloudflare-tmux add|remove|list runs this script):
#   cloudflare-tmux add <cloudflare-email> [linux-user]   default linux-user: you
#   cloudflare-tmux remove <cloudflare-email>
#   cloudflare-tmux people
#   Options: --yes (no questions; refuses instead of asking)
#
# add needs a Cloudflare API token: asked for, or $CF_API_TOKEN; never saved. remove and list don't.
# Mapping an email to a Linux user other than your own needs the multi-user (root) install. add offers to switch.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/config.sh
. "$APP_DIR/scripts/config.sh"
# shellcheck source=scripts/ui.sh
. "$APP_DIR/scripts/ui.sh"

YES=0; ARGS=()
for a in "$@"; do case "$a" in -y|--yes) YES=1 ;; -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;; *) ARGS+=("$a") ;; esac; done
CMD="${ARGS[0]:-}"
die() { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# single: the app is your systemd user service and serves only your Linux user.
# multi:  the app is a root system service (scripts/install-system.sh) and serves any Linux user.
mode() { if [ -f /etc/systemd/system/cloudflare-tmux.service ]; then echo multi; else echo single; fi; }

identities() { env_get IDENTITIES | tr ',' '\n' | sed '/^[[:space:]]*$/d'; }
app_journal() { if [ "$(mode)" = multi ]; then journalctl -u cloudflare-tmux "$@"; else journalctl --user -u cloudflare-tmux "$@"; fi; }
# Emails the running app has loaded (from its last startup line), lower-case, one per line. Empty if unreadable.
running_emails() {
  app_journal --no-pager -o cat 2>/dev/null | grep -o 'identities: .*' | tail -1 | sed 's/identities: //' \
    | tr ',' '\n' | sed 's/^ *//; s/→.*//' | tr '[:upper:]' '[:lower:]'
}
# For each email: "email<TAB>last-login<TAB>last-rejection" from the app log (ISO timestamps, "-" if none).
login_history() {
  app_journal --no-pager -o short-iso 2>/dev/null | awk '
    / attach [^ ]+ by [^ ]+@/ { for (i=1;i<=NF;i++) if ($i=="by") { e=tolower($(i+1)); login[e]=substr($1,1,16) } }
    /email not mapped: / { e=tolower($NF); rej[e]=substr($1,1,16) }
    END { for (e in login) seen[e]=1; for (e in rej) seen[e]=1
          for (e in seen) printf "%s\t%s\t%s\n", e, (e in login ? login[e] : "-"), (e in rej ? rej[e] : "-") }'
}
without() { identities | awk -v e="$1" 'BEGIN{IGNORECASE=1} { n=$0; sub(/:[^:]*$/, "", n); if (tolower(n) != e) print }' | paste -sd, -; }

restart_app() {
  if [ "$(mode)" = multi ]; then
    note "Installing the root service (sudo may ask for your password)..."
    sudo NODE_BIN="$(command -v node)" ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/install-system.sh"
  else
    systemctl --user restart cloudflare-tmux.service
    systemctl --user --no-pager status cloudflare-tmux.service | grep -E "Active:" || true
  fi
}

case "$CMD" in
list)
  RUNNING="$(running_emails)"; HIST="$(login_history)"
  echo
  printf '  %s%-34s %-12s %-17s %s%s\n' "$C_DIM$C_UL" "CLOUDFLARE ACCOUNT" "LINUX USER" "APP" "LAST LOGIN" "$C_RESET"
  while IFS= read -r e; do
    [ -n "$e" ] || continue
    email="$(echo "${e%:*}" | sed 's/^ *//' | tr '[:upper:]' '[:lower:]')"; u="${e##*:}"
    # dot color and plain text kept apart so the column stays aligned with and without colors
    if [ -z "$RUNNING" ]; then dot="$C_YELLOW" app="log unreadable"
    elif echo "$RUNNING" | grep -qxF "$email"; then dot="$C_GREEN" app="live"
    else dot="$C_RED" app="restart needed"; fi
    login="$(echo "$HIST" | awk -F'\t' -v e="$email" '$1==e {print $2}')"; rej="$(echo "$HIST" | awk -F'\t' -v e="$email" '$1==e {print $3}')"
    if [ -n "$login" ] && [ "$login" != - ]; then last="$(tr T ' ' <<< "$login")"
    else last="$(dim never)"; fi
    if [ -n "$rej" ] && [ "$rej" != - ] && { [ -z "$login" ] || [ "$login" = - ] || [[ "$rej" > "$login" ]]; }; then
      last="$last  $(yellow "tried $(tr T ' ' <<< "$rej"), refused by the app")"
    fi
    printf '  %-34s %s%-12s%s %s●%s %-15s %s\n' "$email" "$C_BOLD" "$u" "$C_RESET" "$dot" "$C_RESET" "$app" "$last"
  done < <(identities)
  echo
  note "APP live = the running app accepts them. restart needed = in the config, not applied yet: cloudflare-tmux restart"
  note "LAST LOGIN comes from the app log. 'never' with an accepted invite usually means they haven't tried yet."
  note "Install: $(mode)-user"
  ;;

add)
  EMAIL="$(echo "${ARGS[1]:-}" | tr '[:upper:]' '[:lower:]')"
  LINUX_USER="${ARGS[2]:-$USER}"
  [[ "$EMAIL" == *@*.* ]] || die "usage: cloudflare-tmux add <cloudflare-email> [linux-user]"
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
    warn "The app runs as your user service, so it can only serve Linux user '$USER'."
    note "Serving '$LINUX_USER' needs the multi-user install: the app becomes a root system service"
    note "that starts tmux as each mapped user. See docs/content/install/multi-user.md."
    if [ "$YES" -eq 1 ]; then die "Re-run without --yes to switch, or run: ./install.sh --multi-user"; fi
    read -r -p "Switch to the multi-user install now? It needs sudo. (y/n) [y]: " reply
    [ "${reply:-y}" = y ] || exit 1
    SWITCH=1
  fi

  title "Adding $(cyan "$EMAIL") → Linux user $(bold "$LINUX_USER")"
  echo
  echo "  Before this works, $EMAIL must be a $(bold 'member of your Cloudflare account'):"
  note "dash.cloudflare.com → Manage Account → Members → Invite, role 'Minimal Account Access'. They must accept."
  note "You can run this command before or after that."
  if [ -z "${CF_API_TOKEN:-}" ]; then
    echo
    echo "  This command needs a $(bold 'Cloudflare API token'), used once and never saved."
    note "Create one at $(link https://dash.cloudflare.com/profile/api-tokens) → Create Token → Create Custom Token, with:"
    printf '    %s%-9s%s %-58s %s\n' "$C_DIM" Account "$C_RESET" "Cloudflare Tunnel" "$(bold Edit)"
    printf '    %s%-9s%s %-58s %s\n' "$C_DIM" Account "$C_RESET" "Access: Apps and Policies" "$(bold Edit)"
    printf '    %s%-9s%s %-58s %s\n' "$C_DIM" Account "$C_RESET" "Access: Organizations, Identity Providers, and Groups" "$(bold Read)"
    printf '    %s%-9s%s %-58s %s\n' "$C_DIM" Zone "$C_RESET" "DNS, for the zone of $HOST" "$(bold Edit)"
    note "Set the TTL start date to today. Guide: $(link https://syan-dev.github.io/cloudflare-tmux/cloudflare/api-token.html)"
  fi
  echo

  OLD="$(env_get IDENTITIES)"
  REST="$(without "$EMAIL")"
  NEW="${REST:+$REST,}$EMAIL:$LINUX_USER"
  env_set IDENTITIES "$NEW"
  ok "IDENTITIES=$NEW"

  note "Updating the Access policy on Cloudflare..."
  if ! "$APP_DIR/scripts/cloudflare.sh" "$HOST"; then
    env_set IDENTITIES "$OLD"
    die "Cloudflare update failed. The config was restored; nothing changed."
  fi

  if [ "$SWITCH" -eq 1 ]; then
    note "Switching to the multi-user install (sudo may ask for your password)..."
    sudo NODE_BIN="$(command -v node)" ENV_FILE="$ENV_FILE" "$APP_DIR/scripts/install-system.sh"
  else
    restart_app
  fi

  echo
  title "Result for $(cyan "$EMAIL")"
  ok "config      saved: $EMAIL → $LINUX_USER"
  ok "cloudflare  Access policy allows $EMAIL"
  if running_emails | grep -qxF "$EMAIL"; then ok "app         running with the new list"
  elif [ -z "$(running_emails)" ]; then warn "app         can't read the app log to confirm; run: cloudflare-tmux doctor"
  else bad "app         still running the old list"; fix "cloudflare-tmux restart"; fi
  warn "member      can't be checked from here. They must accept your invite (see below)."
  note "When they log in, it shows under: cloudflare-tmux people"
  echo
  echo "  $(bold 'Still to do:')"
  step 1 "If $EMAIL isn't a member of your Cloudflare account yet, invite it:"
  note "   dash.cloudflare.com → Manage Account → Members → Invite, role 'Minimal Account Access'."
  note "   They must accept the invitation before Cloudflare lets them in."
  step 2 "Delete the API token at $(link https://dash.cloudflare.com/profile/api-tokens). Nothing running uses it."
  step 3 "Send them the link $(link "https://$HOST") and the short guide:"
  note "   $(link https://syan-dev.github.io/cloudflare-tmux/usage.html)"
  ;;

remove)
  EMAIL="$(echo "${ARGS[1]:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$EMAIL" == *@* ]] || die "usage: cloudflare-tmux remove <cloudflare-email>"
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
    note "Later, with a fresh API token, take them out of the Access policy too:"
    note "  scripts/cloudflare.sh $(env_get PUBLIC_HOST)"
  fi
  note "Optional: remove them under Manage Account → Members, and run scripts/totp.js remove $EMAIL if you use the two-step code."
  ;;

*) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
