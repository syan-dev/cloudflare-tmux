#!/usr/bin/env bash
# Installs or updates the official cloudflared binary in ~/.local/bin, verified by SHA-256.
# The tunnel unit runs cloudflared with --no-autoupdate, so run this from time to time to update it.
# No Cloudflare API token needed. Usage: scripts/install-cloudflared.sh [--restart]
#   --restart  restart the tunnel service afterwards if the binary changed
set -euo pipefail

DEST="$HOME/.local/bin/cloudflared"
RESTART=0
[ "${1:-}" = --restart ] && RESTART=1

case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=arm ;; *) arch="" ;; esac
[ -n "$arch" ] || { echo "No prebuilt cloudflared for $(uname -m); install it manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1; }
other="$(command -v cloudflared || true)"
if [ -n "$other" ] && [ "$other" != "$DEST" ]; then
  echo "cloudflared at $other comes first in PATH; update it with your package manager instead."
  exit 1
fi

# Pin the latest release, then require the SHA-256 that GitHub computed for the asset and, when
# listed, the one in Cloudflare's release notes, before the binary is moved into place.
asset="cloudflared-linux-$arch"
release="$(curl -fsSL https://api.github.com/repos/cloudflare/cloudflared/releases/latest)" \
  || { echo "Could not look up the latest cloudflared release"; exit 1; }
read -r tag url digest notes_sum < <(python3 -c 'import sys,json,re
r = json.load(sys.stdin); name = sys.argv[1]
a = next((a for a in r["assets"] if a["name"] == name), None)
if not a: sys.exit("no asset " + name)
m = re.search(r"^" + re.escape(name) + r":\s*([0-9a-f]{64})\s*$", r.get("body") or "", re.M)
print(r["tag_name"], a["browser_download_url"], (a.get("digest") or "-").split(":")[-1], m.group(1) if m else "-")' \
  "$asset" <<< "$release") || { echo "Could not read the cloudflared release metadata"; exit 1; }
[[ "$digest" =~ ^[0-9a-f]{64}$ ]] || { echo "Release $tag has no SHA-256 for $asset; install cloudflared manually."; exit 1; }
[ "$notes_sum" = - ] || [ "$notes_sum" = "$digest" ] \
  || { echo "Checksum mismatch between GitHub and the $tag release notes for $asset; not installing."; exit 1; }

if [ -x "$DEST" ] && echo "$digest  $DEST" | sha256sum -c --quiet - >/dev/null 2>&1; then
  echo "cloudflared $tag is already installed at $DEST"
  exit 0
fi

mkdir -p "$(dirname "$DEST")"
tmp="$(mktemp "$(dirname "$DEST")/.cloudflared.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
curl -fsSL -o "$tmp" "$url" || { echo "Download failed: $url"; exit 1; }
echo "$digest  $tmp" | sha256sum -c --quiet - \
  || { echo "Checksum mismatch for $asset $tag; not installing."; exit 1; }
chmod 755 "$tmp"
mv "$tmp" "$DEST"
trap - EXIT
echo "cloudflared $tag installed to $DEST (sha256 verified)"

if [ "$RESTART" -eq 1 ] && systemctl --user is-enabled cloudflare-tmux-cloudflared >/dev/null 2>&1; then
  systemctl --user restart cloudflare-tmux-cloudflared
  echo "restarted cloudflare-tmux-cloudflared"
fi
