#!/usr/bin/env bash
# Idempotently provisions the Cloudflare side via API:
#   tunnel (remotely managed) + ingress, Cloudflare login, Access application + allow policy, DNS CNAME.
# Usage: scripts/cloudflare.sh [term.example.com]   (default: PUBLIC_HOST from the config)
# Config: ~/.config/cloudflare-tmux/env (see scripts/config.sh). Allowed people come from IDENTITIES
#   (email:linuxuser,...). The hostname and tunnel name are saved there, so re-runs reuse the same tunnel.
# Login: "Sign in with Cloudflare", restricted to members of your Cloudflare account. Each allowed
#   person needs their own Cloudflare account, invited as a member of yours (Minimal Account Access).
# Needs an API token (asked for when run, or $CF_API_TOKEN; never saved) with:
#   Account: Cloudflare Tunnel: Edit, Account: Access: Apps and Policies: Edit,
#   Account: Access: Organizations, Identity Providers, and Groups: Read, Zone: DNS: Edit (one zone).
#   Edit instead of Read on the third is only needed if the Cloudflare login method doesn't exist yet.
# Optional env: ZONE_NAME (default: hostname minus its first label), TUNNEL_NAME (default: saved, else
#   cloudflare-tmux), PORT, ACCESS_SESSION (Access login lifetime, e.g. 8h; default: saved, else 24h).
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/config.sh
. "$APP_DIR/scripts/config.sh"

HOST="${1:-$(env_get PUBLIC_HOST)}"
[ -n "$HOST" ] || { echo "usage: $0 <hostname>"; exit 1; }
ZONE_NAME="${ZONE_NAME:-${HOST#*.}}"
TUNNEL_NAME="${TUNNEL_NAME:-$(env_get TUNNEL_NAME)}"
TUNNEL_NAME="${TUNNEL_NAME:-cloudflare-tmux}"
PORT="${PORT:-7681}"
ACCESS_SESSION="${ACCESS_SESSION:-$(env_get ACCESS_SESSION)}"
ACCESS_SESSION="${ACCESS_SESSION:-24h}"
[[ "$ACCESS_SESSION" =~ ^[0-9]+(m|h)$ ]] || { echo "ACCESS_SESSION must look like 30m or 8h"; exit 1; }
API=https://api.cloudflare.com/client/v4
if [ -n "${CF_API_TOKEN:-}" ]; then TOKEN="$CF_API_TOKEN"
elif [ -t 0 ]; then read -r -s -p "Cloudflare API token (not saved): " TOKEN; echo
else echo "No API token: run interactively, or set CF_API_TOKEN (see docs/content/cloudflare/api-token.md)"; exit 1; fi
[ -n "$TOKEN" ] || { echo "Token is required"; exit 1; }
[ -e "$HOME/.cloudflare-token" ] && echo "  note: ~/.cloudflare-token is no longer used; delete it: rm ~/.cloudflare-token"
IDENTITIES="$(env_get IDENTITIES)"
[ -n "$IDENTITIES" ] || { echo "Set IDENTITIES=email:linuxuser,... in $ENV_FILE"; exit 1; }
EMAILS_JSON="$(python3 -c 'import sys,json
print(json.dumps([{"email":{"email":e.rsplit(":",1)[0].strip().lower()}} for e in sys.argv[1].split(",") if e.strip()]))' "$IDENTITIES")"

cf() {  # cf METHOD PATH [JSON]; prints .result, exits on API error
  # Token and responses (which include the tunnel token) stay off argv, where any local user could see them in ps.
  curl -sS -X "$1" -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") -H 'Content-Type: application/json' \
    "$API$2" ${3:+--data "$3"} | python3 -c 'import sys,json
d=json.load(sys.stdin)
if not d.get("success"): sys.exit("API error on '"$1 $2"': %s" % d.get("errors"))
print(json.dumps(d.get("result")))'
}
jq_() { python3 -c "import sys,json; r=json.load(sys.stdin); print($1)"; }

ZONE_ID="$(cf GET "/zones?name=$ZONE_NAME" | jq_ 'r[0]["id"] if r else ""')"
[ -n "$ZONE_ID" ] || { echo "Zone $ZONE_NAME not found for this token (set ZONE_NAME=yourdomain.com if the guess is wrong)"; exit 1; }
ACCOUNT_ID="$(cf GET "/zones/$ZONE_ID" | jq_ 'r["account"]["id"]')"
echo "zone $ZONE_NAME=$ZONE_ID account=$ACCOUNT_ID"

# 1. Tunnel
TUNNEL_ID="$(cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel?name=$TUNNEL_NAME&is_deleted=false" | jq_ 'r[0]["id"] if r else ""')"
if [ -z "$TUNNEL_ID" ]; then
  TUNNEL_ID="$(cf POST "/accounts/$ACCOUNT_ID/cfd_tunnel" "{\"name\":\"$TUNNEL_NAME\",\"config_src\":\"cloudflare\"}" | jq_ 'r["id"]')"
fi
cf PUT "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  "{\"config\":{\"ingress\":[{\"hostname\":\"$HOST\",\"service\":\"http://127.0.0.1:$PORT\"},{\"service\":\"http_status:404\"}]}}" >/dev/null
(umask 077; mkdir -p "$HOME/.cloudflared"
 cf GET "/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token" | jq_ 'r' > "$HOME/.cloudflared/cloudflare-tmux.token")
echo "tunnel $TUNNEL_NAME=$TUNNEL_ID"

# 2. Cloudflare login (identity provider type "cloudflare"), only for members of this account
IDP_ID="$(cf GET "/accounts/$ACCOUNT_ID/access/identity_providers" | jq_ "next((i['id'] for i in r if i['type']=='cloudflare'), '')")"
if [ -z "$IDP_ID" ]; then
  # Creating it is the only call that needs Edit on Identity Providers; Read covers every re-run.
  if ! IDP_ID="$(cf POST "/accounts/$ACCOUNT_ID/access/identity_providers" \
    '{"name":"Cloudflare","type":"cloudflare","config":{"restrict_to_account_members":true}}' | jq_ 'r["id"]')"; then
    echo "  The 'Cloudflare' login method doesn't exist yet and this token can't create it. Either:"
    echo "  - add it once in Zero Trust > Settings > Authentication > Login methods (turn on"
    echo "    'restrict to account members'), then re-run, or"
    echo "  - give the token Edit on 'Access: Organizations, Identity Providers, and Groups' for this run."
    exit 1
  fi
elif [ "$(cf GET "/accounts/$ACCOUNT_ID/access/identity_providers/$IDP_ID" | jq_ "r.get('config',{}).get('restrict_to_account_members')")" != True ]; then
  echo "  warning: Cloudflare login is not restricted to account members."
  echo "  Turn on 'restrict to account members' in Zero Trust > Settings > Authentication > Cloudflare."
fi
echo "cloudflare login idp=$IDP_ID"

# 3. Access application: Cloudflare login only, allow exactly the mapped emails
# (created before DNS, so the hostname is never reachable unprotected)
TEAM_DOMAIN="$(cf GET "/accounts/$ACCOUNT_ID/access/organizations" | jq_ 'r["auth_domain"]')"
APP_ID="$(cf GET "/accounts/$ACCOUNT_ID/access/apps" | jq_ "next((a['id'] for a in r if a.get('domain')=='$HOST'), '')")"
POLICY="{\"name\":\"Mapped Cloudflare accounts\",\"decision\":\"allow\",\"include\":$EMAILS_JSON}"
APP_BODY="{\"name\":\"cloudflare-tmux\",\"type\":\"self_hosted\",\"domain\":\"$HOST\",\"session_duration\":\"$ACCESS_SESSION\",
  \"allowed_idps\":[\"$IDP_ID\"],\"auto_redirect_to_identity\":true,
  \"app_launcher_visible\":true,\"http_only_cookie_attribute\":true,
  \"same_site_cookie_attribute\":\"lax\",\"policies\":[$POLICY]}"
if [ -z "$APP_ID" ]; then
  APP_ID="$(cf POST "/accounts/$ACCOUNT_ID/access/apps" "$APP_BODY" | jq_ 'r["id"]')"
else
  cf PUT "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" "$APP_BODY" >/dev/null
fi
AUD="$(cf GET "/accounts/$ACCOUNT_ID/access/apps/$APP_ID" | jq_ 'r["aud"]')"
echo "access app=$APP_ID team=$TEAM_DOMAIN allow=$(echo "$EMAILS_JSON" | jq_ '",".join(x["email"]["email"] for x in r)')"

# 4. DNS: proxied CNAME to the tunnel
TARGET="$TUNNEL_ID.cfargotunnel.com"
REC_ID="$(cf GET "/zones/$ZONE_ID/dns_records?name=$HOST" | jq_ 'r[0]["id"] if r else ""')"
REC="{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"$TARGET\",\"proxied\":true,\"comment\":\"cloudflare-tmux tunnel\"}"
if [ -z "$REC_ID" ]; then cf POST "/zones/$ZONE_ID/dns_records" "$REC" >/dev/null
else cf PUT "/zones/$ZONE_ID/dns_records/$REC_ID" "$REC" >/dev/null; fi
echo "dns $HOST -> $TARGET"

# 5. App config
env_set PUBLIC_HOST "$HOST"
env_set TUNNEL_NAME "$TUNNEL_NAME"
env_set PORT "$PORT"
env_set ACCESS_SESSION "$ACCESS_SESSION"
env_set CF_TEAM_DOMAIN "$TEAM_DOMAIN"
env_set CF_ACCESS_AUD "$AUD"
echo "wrote $ENV_FILE"
