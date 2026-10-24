#!/usr/bin/env bash
# Checks a cloudflare-tmux install and prints one line per check with the fix when something is wrong.
# Usage: cloudflare-tmux doctor
#        CF_API_TOKEN=... cloudflare-tmux doctor   also compares the Cloudflare Access policy with IDENTITIES
# Needs no root. Exit code 1 if any check failed.
set -uo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/config.sh
. "$APP_DIR/scripts/config.sh"
# shellcheck source=scripts/ui.sh
. "$APP_DIR/scripts/ui.sh"

FAILED=0
section() { title "$*"; }

# User-service commands work from cron or sudo too.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
if [ -f /etc/systemd/system/cloudflare-tmux.service ]; then MODE=multi; else MODE=single; fi

# ---------- config ----------
section "Config  $(dim "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  bad "config file missing"; fix "run ./install.sh"
  exit 1
fi
ok "config file exists ($(stat -c %a "$ENV_FILE"), should be 600)"
[ "$(stat -c %a "$ENV_FILE")" = 600 ] || { warn "config file is not mode 600"; fix "chmod 600 $ENV_FILE"; }
for k in PUBLIC_HOST CF_TEAM_DOMAIN CF_ACCESS_AUD IDENTITIES; do
  if [ -n "$(env_get "$k")" ]; then ok "$k is set"; else bad "$k is empty"; fix "run scripts/cloudflare.sh <hostname>, or ./install.sh"; fi
done
HOST="$(env_get PUBLIC_HOST)"; PORT="$(env_get PORT)"; PORT="${PORT:-7681}"
IDENTITIES="$(env_get IDENTITIES)"

# ---------- people ----------
section "People (IDENTITIES)"
IFS=',' read -ra entries <<< "$IDENTITIES"
for e in "${entries[@]}"; do
  [ -n "$e" ] || continue
  email="${e%:*}"; u="${e##*:}"
  if [[ "$e" != *@*:?* ]]; then bad "'$e' is not email:linuxuser"; fix "cloudflare-tmux add <email> <linux-user>"; continue; fi
  if [ "$u" = root ]; then bad "$email maps to root, which is refused"; continue; fi
  pw="$(getent passwd "$u" || true)"
  if [ -z "$pw" ]; then bad "$email -> $u: Linux user does not exist"; fix "sudo adduser $u"; continue; fi
  shell="$(echo "$pw" | cut -d: -f7)"
  if [[ "$shell" =~ (nologin|false)$ ]]; then bad "$email -> $u: no login shell ($shell)"; fix "sudo chsh -s /bin/bash $u"; continue; fi
  if [ "$MODE" = single ] && [ "$u" != "$USER" ]; then
    bad "$email -> $u, but the single-user app runs as $USER and can only serve $USER"
    fix "sudo NODE_BIN=\"\$(command -v node)\" scripts/install-system.sh   (multi-user install)"; continue
  fi
  ok "$email -> $u"
  groups_of="$(id -nG "$u" 2>/dev/null | tr ' ' '\n' | grep -xE 'sudo|wheel|admin|docker|lxd' | paste -sd, -)"
  [ -z "$groups_of" ] || warn "$u is in root-equivalent group(s): $groups_of. Anyone who logs in as $email has that power."
done

# ---------- services ----------
section "Services  $(dim "$MODE-user install")"
if [ "$MODE" = multi ]; then
  if systemctl is-active -q cloudflare-tmux.service; then ok "app service active (root)"; else bad "app service not running"; fix "sudo systemctl restart cloudflare-tmux; sudo journalctl -u cloudflare-tmux -n 30"; fi
  if systemctl is-enabled -q cloudflare-tmux.service; then ok "app service starts at boot"; else bad "app service not enabled"; fix "sudo systemctl enable cloudflare-tmux"; fi
  if systemctl --user is-active -q cloudflare-tmux.service 2>/dev/null; then bad "the old single-user app service is also running; both want port $PORT"; fix "systemctl --user disable --now cloudflare-tmux"; fi
  running="$(journalctl -u cloudflare-tmux -n 300 --no-pager 2>/dev/null | grep -o 'identities: .*' | tail -1 | sed 's/identities: //')"
else
  if systemctl --user is-active -q cloudflare-tmux.service; then ok "app service active (as $USER)"; else bad "app service not running"; fix "systemctl --user restart cloudflare-tmux; journalctl --user -u cloudflare-tmux -n 30"; fi
  if systemctl --user is-enabled -q cloudflare-tmux.service; then ok "app service starts at boot"; else bad "app service not enabled"; fix "systemctl --user enable cloudflare-tmux"; fi
  running="$(journalctl --user -u cloudflare-tmux -n 300 --no-pager 2>/dev/null | grep -o 'identities: .*' | tail -1 | sed 's/identities: //')"
fi
if [ -n "$running" ]; then
  want="$(echo "$IDENTITIES" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | awk -F: '{ u=$NF; sub(/:[^:]*$/, ""); print tolower($0) "→" u }' | sort | paste -sd, -)"
  have="$(echo "$running" | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sort | paste -sd, -)"
  if [ "$want" = "$have" ]; then ok "running app uses the current IDENTITIES"
  else
    bad "running app has a different list than the config: $running"
    if [ "$MODE" = multi ]; then fix "sudo NODE_BIN=\"\$(command -v node)\" scripts/install-system.sh"; else fix "systemctl --user restart cloudflare-tmux"; fi
  fi
else
  warn "could not read the app log to compare the running list (not in group adm/systemd-journal?)"
fi
if systemctl --user is-active -q cloudflare-tmux-cloudflared.service; then ok "tunnel service active"; else bad "tunnel service not running"; fix "systemctl --user restart cloudflare-tmux-cloudflared; journalctl --user -u cloudflare-tmux-cloudflared -n 30"; fi
if systemctl --user is-enabled -q cloudflare-tmux-cloudflared.service; then ok "tunnel service starts at boot"; else bad "tunnel service not enabled"; fix "systemctl --user enable cloudflare-tmux-cloudflared"; fi
if loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then ok "linger on: user services run without a login"
else bad "linger off: the tunnel stops when you log out and won't start at boot"; fix "sudo loginctl enable-linger $USER"; fi
if [ -s "$HOME/.cloudflared/cloudflare-tmux.token" ]; then ok "tunnel token present"; else bad "tunnel token missing"; fix "scripts/cloudflare.sh $HOST"; fi

# ---------- reachability ----------
section "Reachability"
code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
case "$code" in
  401) ok "app answers on 127.0.0.1:$PORT (401: wants a login, as it should)" ;;
  200) warn "app answers on 127.0.0.1:$PORT without a login. Is AUTH_DISABLED set? Never in production." ;;
  000|"") bad "nothing answers on 127.0.0.1:$PORT"; fix "check the app service above" ;;
  *) warn "app answers on 127.0.0.1:$PORT with HTTP $code" ;;
esac
if [ -n "$HOST" ]; then
  hdr="$(curl -sI -m 10 "https://$HOST/" 2>/dev/null || true)"
  pcode="$(echo "$hdr" | awk 'NR==1{print $2}')"
  loc="$(echo "$hdr" | grep -i '^location:' | tr -d '\r')"
  if [ "$pcode" = 302 ] && echo "$loc" | grep -q cloudflareaccess.com; then ok "https://$HOST redirects to the Cloudflare login page"
  elif [ -z "$pcode" ]; then bad "https://$HOST does not answer (DNS or network)"; fix "scripts/cloudflare.sh $HOST   (re-creates the DNS record)"
  elif [ "$pcode" = 530 ] || echo "$hdr" | grep -qi 'cf-error\|1033'; then bad "https://$HOST: Cloudflare error 1033/530, the tunnel is not connected"; fix "check the tunnel service above"
  elif [ "$pcode" = 502 ]; then bad "https://$HOST: 502, the tunnel is up but the app isn't answering on port $PORT"
  else warn "https://$HOST answers with HTTP $pcode (expected a 302 to the login page). Is Access set up for this hostname?"; fix "scripts/cloudflare.sh $HOST"
  fi
fi

# ---------- Cloudflare policy (optional) ----------
section "Cloudflare Access policy"
if [ -z "${CF_API_TOKEN:-}" ]; then
  warn "skipped: set CF_API_TOKEN to compare the Access policy with IDENTITIES (see docs/content/cloudflare/api-token.md)"
else
  API=https://api.cloudflare.com/client/v4
  cfget() { curl -sS -m 20 -H @<(printf 'Authorization: Bearer %s\n' "$CF_API_TOKEN") "$API$1"; }
  ZONE_NAME="${ZONE_NAME:-${HOST#*.}}"
  ACCOUNT_ID="$(cfget "/zones?name=$ZONE_NAME" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("result") or []; print(r[0]["account"]["id"] if r else "")' 2>/dev/null)"
  if [ -z "$ACCOUNT_ID" ]; then bad "token can't see zone $ZONE_NAME"; fix "check the token's permissions and Zone Resources"
  else
    allowed="$(cfget "/accounts/$ACCOUNT_ID/access/apps" | python3 -c 'import sys,json
d=json.load(sys.stdin); host=sys.argv[1]
app=next((a for a in d.get("result") or [] if a.get("domain")==host), None)
if not app: sys.exit("noapp")
emails=set()
for p in app.get("policies") or []:
    for i in p.get("include") or []:
        if "email" in i: emails.add(i["email"]["email"].lower())
print(",".join(sorted(emails)))' "$HOST" 2>/dev/null)" || allowed=""
    if [ -z "$allowed" ]; then bad "no Access application for $HOST in this account"; fix "scripts/cloudflare.sh $HOST"
    else
      want="$(echo "$IDENTITIES" | tr ',' '\n' | sed 's/:[^:]*$//; s/^ *//' | tr '[:upper:]' '[:lower:]' | sort | paste -sd, -)"
      if [ "$want" = "$allowed" ]; then ok "Access policy allows exactly the people in IDENTITIES"
      else bad "Access policy ($allowed) differs from IDENTITIES ($want)"; fix "scripts/cloudflare.sh $HOST"; fi
    fi
  fi
fi

echo
if [ "$FAILED" -eq 0 ]; then printf '%s✓ All checks passed.%s\n' "$C_GREEN$C_BOLD" "$C_RESET"
else printf '%s✗ Some checks failed.%s %sSee the fix lines above.%s\n' "$C_RED$C_BOLD" "$C_RESET" "$C_DIM" "$C_RESET"; fi
exit "$FAILED"
