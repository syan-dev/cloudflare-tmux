#!/usr/bin/env bash
# Idempotently provisions the Cloudflare side via API:
#   tunnel (remotely managed) + ingress, Google login, Access application + allow policy, DNS CNAME.
# Usage: scripts/cloudflare.sh term.example.com
# Allowed people come from IDENTITIES in .env (email:linuxuser,...).
# Google login: uses an existing Google identity provider, or creates one from
#   ~/.cloudflare-tmux-google-oauth (line 1: OAuth client ID, line 2: client secret).
# Needs an API token in $CF_API_TOKEN or ~/.cloudflare-token with:
#   Account: Cloudflare Tunnel: Edit, Account: Access: Apps and Policies: Edit,
#   Account: Access: Organizations, Identity Providers, and Groups: Edit, Zone: DNS: Edit
# Optional env: ZONE_NAME (default: hostname minus its first label), TUNNEL_NAME, PORT.
set -euo pipefail

HOST="${1:?usage: $0 <hostname>}"
ZONE_NAME="${ZONE_NAME:-${HOST#*.}}"
TUNNEL_NAME="${TUNNEL_NAME:-cloudflare-tmux}"
PORT="${PORT:-7681}"
API=https://api.cloudflare.com/client/v4
if [ -n "${CF_API_TOKEN:-}" ]; then TOKEN="$CF_API_TOKEN"
elif [ -s "$HOME/.cloudflare-token" ]; then TOKEN="$(tr -d '[:space:]' < "$HOME/.cloudflare-token")"
else echo "No API token: set CF_API_TOKEN or save it to ~/.cloudflare-token (chmod 600)"; exit 1; fi
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
OAUTH_FILE="$HOME/.cloudflare-tmux-google-oauth"

IDENTITIES="$(sed -n 's/^IDENTITIES=//p' "$ENV_FILE" 2>/dev/null | tail -1)"
[ -n "$IDENTITIES" ] || { echo "Set IDENTITIES=email:linuxuser,... in $ENV_FILE"; exit 1; }
EMAILS_JSON="$(python3 -c 'import sys,json
print(json.dumps([{"email":{"email":e.rsplit(":",1)[0].strip().lower()}} for e in sys.argv[1].split(",") if e.strip()]))' "$IDENTITIES")"

cf() {  # cf METHOD PATH [JSON]; prints .result, exits on API error
  local out
  out="$(curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    "$API$2" ${3:+--data "$3"})"
  python3 -c 'import sys,json
d=json.loads(sys.argv[1])
if not d.get("success"): sys.exit("API error on '"$1 $2"': %s" % d.get("errors"))
print(json.dumps(d.get("result")))' "$out"
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

# 2. Google identity provider
IDP_ID="$(cf GET "/accounts/$ACCOUNT_ID/access/identity_providers" | jq_ "next((i['id'] for i in r if i['type']=='google'), '')")"
if [ -z "$IDP_ID" ]; then
  [ -s "$OAUTH_FILE" ] || { echo "No Google login configured. Put the OAuth client ID and secret in $OAUTH_FILE (2 lines)."; exit 1; }
  CLIENT_ID="$(sed -n 1p "$OAUTH_FILE" | tr -d '[:space:]')"
  CLIENT_SECRET="$(sed -n 2p "$OAUTH_FILE" | tr -d '[:space:]')"
  IDP_ID="$(cf POST "/accounts/$ACCOUNT_ID/access/identity_providers" \
    "{\"name\":\"Google\",\"type\":\"google\",\"config\":{\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\"}}" | jq_ 'r["id"]')"
fi
echo "google idp=$IDP_ID"

# 3. Access application: Google only, allow exactly the mapped emails
# (created before DNS, so the hostname is never reachable unprotected)
TEAM_DOMAIN="$(cf GET "/accounts/$ACCOUNT_ID/access/organizations" | jq_ 'r["auth_domain"]')"
APP_ID="$(cf GET "/accounts/$ACCOUNT_ID/access/apps" | jq_ "next((a['id'] for a in r if a.get('domain')=='$HOST'), '')")"
POLICY="{\"name\":\"Mapped Google accounts\",\"decision\":\"allow\",\"include\":$EMAILS_JSON}"
APP_BODY="{\"name\":\"cloudflare-tmux\",\"type\":\"self_hosted\",\"domain\":\"$HOST\",\"session_duration\":\"24h\",
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
[ -f "$ENV_FILE" ] || cp "$APP_DIR/.env.example" "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() { grep -q "^$1=" "$ENV_FILE" && sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
set_env PORT "$PORT"
set_env CF_TEAM_DOMAIN "$TEAM_DOMAIN"
set_env CF_ACCESS_AUD "$AUD"
echo "wrote $ENV_FILE"
