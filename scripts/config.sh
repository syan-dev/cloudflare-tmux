# shellcheck shell=bash
# Sourced by the setup scripts: where the app config lives.
# Config is kept outside the code: ~/.config/cloudflare-tmux/env (mode 600, directory 700).
# A legacy .env next to the app is moved there on first use. ENV_FILE overrides the location.
# Expects APP_DIR to be set.

CONFIG_DIR="$HOME/.config/cloudflare-tmux"
ENV_FILE="${ENV_FILE:-$CONFIG_DIR/env}"

if [ ! -f "$ENV_FILE" ] && [ -f "$APP_DIR/.env" ]; then
  (umask 077; mkdir -p "$(dirname "$ENV_FILE")")
  mv "$APP_DIR/.env" "$ENV_FILE"
  echo "Moved $APP_DIR/.env to $ENV_FILE"
fi

env_get() { sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1; }
env_set() {
  (umask 077; mkdir -p "$(dirname "$ENV_FILE")")
  [ -f "$ENV_FILE" ] || cp "$APP_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  if grep -q "^$1=" "$ENV_FILE"; then
    python3 -c 'import sys
path, key, val = sys.argv[1:]
lines = open(path).read().splitlines()
open(path, "w").write("\n".join(f"{key}={val}" if l.startswith(key + "=") else l for l in lines) + "\n")' "$ENV_FILE" "$1" "$2"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}
