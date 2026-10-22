---
title: Usage
description: Using the session dashboard, the terminal, the mobile key bar, and tmux itself.
---

# Usage

## Dashboard

Opening your hostname shows the **dashboard**: every tmux session of your Linux user, most recently active first.

- **New session**: type a name (letters, digits, `_`, `-`, up to 32 characters) and press *New session*. You're attached right away.
- **Open**: attach to a session. A green dot means another client (another tab, device, or local `tmux attach`) is attached too.
- **Rename** / **Kill**: rename the session, or end it and everything running in it.
- **Log out**: ends your Cloudflare Access session.

Sessions are also linkable: `https://term.example.com/#/s/work` opens (or creates) the session `work`.

## Terminal

- **← Sessions** goes back to the dashboard. The session keeps running.
- If the connection drops (Wi-Fi change, laptop sleep), the page **reconnects by itself** with backoff.
  If your Access session has expired, it reloads so you can sign in again.
- Several tabs or devices can attach to the same session at once. They all see the same screen, which is handy for pair work.

## Mobile key bar

On touch devices a key bar appears under the terminal:

| Key | Sends |
|---|---|
| Esc, Tab | `Esc`, `Tab` |
| Ctrl | arms Ctrl for the **next** key you type (e.g. Ctrl then `c` = `^C`) |
| ^B | the tmux prefix (`Ctrl-b`) |
| ↑ ↓ ← → | arrow keys |
| \| ~ | characters that are awkward on phone keyboards |

## tmux basics

Inside a session, tmux works as usual (prefix = `Ctrl-b`):

| Keys | Action |
|---|---|
| `Ctrl-b c` | new window |
| `Ctrl-b n` / `Ctrl-b p` | next / previous window |
| `Ctrl-b "` / `Ctrl-b %` | split horizontally / vertically |
| `Ctrl-b o` | next pane |
| `Ctrl-b [` | scroll / copy mode (`q` to leave) |
| `Ctrl-b d` | detach (same as closing the tab) |

Mouse-wheel scrolling: add this to `~/.tmux.conf`, then run `tmux source ~/.tmux.conf`:

```bash
set -g mouse on
```

## Same sessions from the server

The web sessions are ordinary tmux sessions of your user:

```bash
tmux ls
tmux attach -t work
```

Start a long job from SSH at your desk, then check on it later from your phone.
