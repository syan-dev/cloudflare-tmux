---
title: Using it
description: The session dashboard, the terminal, copy and paste, the file panel, phones, and tmux itself.
---

# Using it

## Dashboard

Opening your hostname shows the **dashboard**. It lists every tmux session of your Linux user, most recently
active first. Your name and email are at the top right, next to **Log out**.

![The dashboard: your sessions, with Open, Rename and Kill](assets/img/dashboard.png)

- **New session**: type a name and press *New session*. Names take letters, digits, `_` and `-`, up to 32
  characters. You're attached right away.
- **Open**: attach to a session. A green dot means another client is attached too, such as another tab,
  another device or a local `tmux attach`.
- **Rename** and **Kill**: rename the session, or end it and everything running in it.
- **Log out**: ends your Cloudflare login.

Sessions have links: `https://term.example.com/#/s/work` opens the session `work`, creating it if needed.

## Terminal

![A tmux session in the browser, under one slim top bar](assets/img/terminal.png)

- The bar at the top shows the session's name and a dot. Green means connected. Yellow means it is
  reconnecting, with a word on what is happening.
- **Sessions**, the ☰ at the top left, goes back to the dashboard. The session keeps running.
- **Files** at the top right opens the file panel. The person icon logs you out.
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

Press **Files** at the top right to open the file panel beside the terminal. It opens in the folder the
terminal is in. Press **Files** again to close it.

![The file panel next to a terminal, after pasting a screenshot](assets/img/files.png)

### Resize the panel

1. Point at the line between the panel and the terminal. It turns blue.
2. Drag it left or right. The terminal keeps at least 320 pixels.
3. Double-click the line to go back to the default width.

You can also press Tab until the line is selected, then use the arrow keys. Hold Shift for bigger steps.
Your browser remembers the width. On a phone the panel covers the terminal instead, so there is nothing to
resize.

### Browse

- Click a folder to expand it in place, as in VS Code. Click it again to fold it.
- The path above the tree shows the current root. Click any part of it, or **↑**, to go up.
- **⋯** at the top has **Show hidden files**, **Collapse folders**, **Home folder**, **The terminal's folder**
  and **Open folder…**.
- Double-click a file, or press Enter on it, to download it.
- Hover a row for two buttons. The terminal icon types the path into the terminal, quoted if needed. **⋯**
  opens the row's menu. Dragging a row onto the terminal also types its path.
- The keyboard works as in VS Code: arrow keys move and fold, **F2** renames, **Delete** deletes.

### Rename, move, delete

Right-click a row, or press its **⋯**, for a menu. On a phone the menu slides up from the bottom.

![The row menu: Download, Insert path, Copy path, Rename, Move to and Delete](assets/img/menu.png)

- **Rename…** turns the name into a text box. Enter saves, Escape cancels.
- **Move** by dragging a row onto a folder, onto a part of the path, or onto **↑**. The message in the corner
  has an **Undo** button. **Move to…** asks for a folder instead, for phones and far-away folders.
- **Delete** always asks first, in a dialog that names the file. For a folder it says "and everything in it".
  **Cancel** is selected, so pressing Enter or Escape keeps the file. There is no trash, so a delete is final.

Nothing ever replaces an existing file. A move onto a name that exists is refused.

### Upload

There are four ways in.

1. **Paste a screenshot.** Copy an image, then paste with **Ctrl+Shift+V** (Mac: **Cmd+V**) anywhere on the
   page. It is saved as `pasted-<date>-<time>.png` in the panel's folder and its path is typed into the
   terminal, ready for the command you are writing. Pasted text still goes to the terminal as usual.
2. **Drop on the terminal.** Drag files or folders from your computer onto the terminal. They upload and their
   paths are typed, as in VS Code.
3. **Drop on the panel.** Drag onto the tree to upload without typing anything. Drop onto a folder to
   upload into that folder.
4. **Use the buttons.** The upload arrow at the top of the panel picks files from your device. On a phone a
   clipboard button also appears. It uploads a copied photo, because phones rarely pass images to a paste.

The buttons upload into the selected folder, or the root when nothing is selected. A message in the corner
shows progress, a thumbnail for images, and **Cancel**. When a file with the same name exists, it asks
whether to **Replace** it, **Keep both** as `name (2).ext`, or **Skip**. Dropped folders keep their structure.

The file panel runs as your Linux user, so you see exactly what `ls` would show you. Uploads are limited to
`MAX_UPLOAD_MB`, 100 MB by default, which is also what Cloudflare's free plan allows per request.

## On a phone

<img src="assets/img/phone.png" width="300" alt="The terminal on a phone, with the key bar at the bottom">

The terminal works on a phone too. Three things help.

- **Swipe to scroll.** Swipe up or down on the terminal. It scrolls tmux, vim or less, like a mouse wheel.
  A quick flick keeps scrolling for a moment.
- **The prompt stays in view.** When the keyboard opens, the terminal shrinks to fit above it.
- **A key bar** sits under the terminal:

| Key | Sends |
|---|---|
| Esc, Tab | `Esc`, `Tab` |
| Ctrl | arms Ctrl for the **next** key you type, so Ctrl then `c` sends `^C` |
| ^B | the tmux prefix, `Ctrl-b` |
| ↑ ↓ ← → | arrow keys |
| \| ~ | characters that are awkward on phone keyboards |

The file panel covers the whole screen on a phone. Close it with **×** to get back to the terminal.

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

With `mouse on`, a swipe on a phone scrolls tmux's history too. Swipe back to the bottom to leave scroll mode.

## Same sessions from the server

The web sessions are ordinary tmux sessions of your user:

```bash
tmux ls
tmux attach -t work
```

Start a long job from SSH at your desk, then check on it later from your phone.
