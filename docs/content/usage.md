---
title: Using it
description: Using the session dashboard, the terminal, the mobile key bar, and tmux itself.
---

# Using it

## Dashboard

Opening your hostname shows the **dashboard**: every tmux session of your Linux user, most recently active
first.

- **New session**: type a name and press *New session*. Names take letters, digits, `_` and `-`, up to 32
  characters. You're attached right away.
- **Open**: attach to a session. A green dot means another client is attached too, such as another tab,
  another device or a local `tmux attach`.
- **Rename** and **Kill**: rename the session, or end it and everything running in it.
- **Log out**: ends your Cloudflare Access session.

Sessions have links: `https://term.example.com/#/s/work` opens the session `work`, creating it if needed.

## Terminal

- **Sessions** at the top left, or **✕** on the terminal's tab, goes back to the dashboard. The session keeps
  running.
- If the connection drops, after a Wi-Fi change or laptop sleep, the page **reconnects by itself**. If your
  Access login has expired, it reloads so you can sign in again.
- Several tabs or devices can attach to the same session at once. They all see the same screen, which is
  handy for pair work.

## Copy and paste

| Action | How |
|---|---|
| Copy with tmux, works with `mouse on` | drag to select and release, or `Ctrl-b [`, select, `Enter`. The text lands on your computer's clipboard. |
| Copy a browser selection | hold **Shift** (Mac: **Option**) while dragging, then **Ctrl+Shift+C** (Mac: **Cmd+C**) |
| Paste | **Ctrl+Shift+V** (Mac: **Cmd+V**), or right-click → Paste |

Plain **Ctrl+C** always sends `^C` to the program.

Copies made in tmux reach your clipboard, and so do copies from programs inside tmux such as vim. Copying only
goes one way: nothing in the terminal can read your clipboard. This needs tmux 3.2 or newer.

## Files

The terminal page is laid out like VS Code in the browser. A bar of icons runs down the left. Press the
**Explorer** icon, the two pages, to open your files beside the terminal. On a phone, press **Files** at the
top right instead. The Explorer opens in the folder the terminal is in.

![The Explorer next to a terminal, after pasting a screenshot](assets/img/files.png)

### Browse

- Click a folder to expand it in place, as in VS Code. Click it again to fold it.
- The path above the tree shows the current root. Click any part of it, or **↑**, to go up.
- **⋯** at the top has **Show hidden files**, **Home folder**, **The terminal's folder** and **Open folder…**.
- Double-click a file, or press Enter on it, to download it.
- Hover a row for two buttons. The terminal icon types the path into the terminal, quoted if needed. **⋯**
  opens the row's menu. Dragging a row onto the terminal also types its path.
- The keyboard works as in VS Code: arrow keys move and fold, **F2** renames, **Delete** deletes.

### Rename, move, delete

Right-click a row, or press its **⋯**, for a menu. On a phone the menu slides up from the bottom.

- **Rename…** turns the name into a text box. Enter saves, Escape cancels.
- **Move** by dragging a row onto a folder, onto a part of the path, or onto **↑**. The message in the corner
  has an **Undo** button. **Move to…** asks for a folder instead, for phones and far-away folders.
- **Delete** always asks first, in a dialog that names the file. For a folder it says "and everything in it".
  **Cancel** is selected, so pressing Enter or Escape keeps the file. There is no trash, so a delete is final.

Nothing ever replaces an existing file. A move onto a name that exists is refused.

### Upload

There are four ways in.

1. **Paste a screenshot.** Copy an image, then paste with **Ctrl+Shift+V** (Mac: **Cmd+V**) anywhere on the
   page. It is saved as `pasted-<date>-<time>.png` in the Explorer's folder and its path is typed into the
   terminal, ready for the command you are writing. Pasted text still goes to the terminal as usual.
2. **Drop on the terminal.** Drag files or folders from your computer onto the terminal. They upload and their
   paths are typed, as in VS Code.
3. **Drop on the Explorer.** Drag onto the tree to upload without typing anything. Drop onto a folder to
   upload into that folder.
4. **Use the buttons.** The upload arrow at the top of the Explorer picks files from your device. On a phone a
   clipboard button also appears. It uploads a copied photo, because phones rarely pass images to a paste.

The buttons upload into the selected folder, or the root when nothing is selected. A message in the corner
shows progress, a thumbnail for images, and **Cancel**. When a file with the same name exists, it asks
whether to **Replace** it, **Keep both** as `name (2).ext`, or **Skip**. Dropped folders keep their structure.

The Explorer runs as your Linux user, so you see exactly what `ls` would show you. Uploads are limited to
`MAX_UPLOAD_MB`, 100 MB by default, which is also what Cloudflare's free plan allows per request.

## Mobile key bar

On touch devices a key bar appears under the terminal:

| Key | Sends |
|---|---|
| Esc, Tab | `Esc`, `Tab` |
| Ctrl | arms Ctrl for the **next** key you type, so Ctrl then `c` sends `^C` |
| ^B | the tmux prefix, `Ctrl-b` |
| ↑ ↓ ← → | arrow keys |
| \| ~ | characters that are awkward on phone keyboards |

## tmux basics

Inside a session, tmux works as usual. The prefix is `Ctrl-b`.

| Keys | Action |
|---|---|
| `Ctrl-b c` | new window |
| `Ctrl-b n` / `Ctrl-b p` | next / previous window |
| `Ctrl-b "` / `Ctrl-b %` | split horizontally / vertically |
| `Ctrl-b o` | next pane |
| `Ctrl-b [` | scroll and copy mode, `q` to leave |
| `Ctrl-b d` | detach, same as closing the tab |

For mouse-wheel scrolling, add this to `~/.tmux.conf`, then run `tmux source ~/.tmux.conf`:

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
