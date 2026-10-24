# shellcheck shell=bash
# Shared terminal styling for the cloudflare-tmux command and the scripts behind it.
# Colors are on only when stdout is a terminal and NO_COLOR is unset (https://no-color.org).

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  C_RESET=$'\033[0m'  C_BOLD=$'\033[1m'    C_DIM=$'\033[2m'    C_UL=$'\033[4m'
  C_RED=$'\033[31m'   C_GREEN=$'\033[32m'  C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m'
  C_MAGENTA=$'\033[35m' C_CYAN=$'\033[36m'
else
  C_RESET='' C_BOLD='' C_DIM='' C_UL='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_MAGENTA='' C_CYAN=''
fi
export C_RESET C_BOLD C_DIM C_UL C_RED C_GREEN C_YELLOW C_BLUE C_MAGENTA C_CYAN

bold()  { printf '%s%s%s' "$C_BOLD" "$*" "$C_RESET"; }
dim()   { printf '%s%s%s' "$C_DIM" "$*" "$C_RESET"; }
cyan()  { printf '%s%s%s' "$C_CYAN" "$*" "$C_RESET"; }
green() { printf '%s%s%s' "$C_GREEN" "$*" "$C_RESET"; }
yellow(){ printf '%s%s%s' "$C_YELLOW" "$*" "$C_RESET"; }
red()   { printf '%s%s%s' "$C_RED" "$*" "$C_RESET"; }
link()  { printf '%s%s%s%s' "$C_UL$C_CYAN" "$*" "$C_RESET" ''; }

# Section title: bold, with a dim rule underneath.
title() { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
# Result lines
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
# shellcheck disable=SC2034  # FAILED is read by doctor.sh
bad()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$*"; FAILED=1; }
fix()  { printf '      %sfix:%s %s%s%s\n' "$C_DIM" "$C_RESET" "$C_CYAN" "$*" "$C_RESET"; }
note() { printf '  %s%s%s\n' "$C_DIM" "$*" "$C_RESET"; }
# Status dots
up()   { printf '%s●%s %s' "$C_GREEN" "$C_RESET" "$*"; }
down() { printf '%s●%s %s' "$C_RED" "$C_RESET" "$*"; }
# key/value row: dim key padded to 9, then value
row()  { printf '  %s%-9s%s %s\n' "$C_DIM" "$1" "$C_RESET" "$2"; }
# numbered step for "what to do next" lists
step() { printf '  %s%s.%s %s\n' "$C_BOLD" "$1" "$C_RESET" "$2"; }
