---
title: Install
description: Get cloudflare-tmux running on your server in about five minutes with one command.
---

# Install

One command takes you from a fresh server to a working `https://term.example.com`. About five minutes.

> [!NOTE]
> First read [Before you start](prerequisites.md): a domain on Cloudflare, Zero Trust turned on, and a Linux
> server with Node.js 18 or newer. All on free plans.

## 1. Get the code

```bash
git clone https://github.com/syan-dev/cloudflare-tmux.git
cd cloudflare-tmux
```

## 2. Create a Cloudflare API token

The installer uses this token to set up Cloudflare for you. It's needed only during setup.

Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens), choose
**Create Token → Create Custom Token**, and add these four permissions:

| Scope | Permission | Access |
|---|---|---|
| Account | Cloudflare Tunnel | Edit |
| Account | Access: Apps and Policies | Edit |
| Account | Access: Organizations, Identity Providers, and Groups | Read |
| Zone | DNS | Edit |

Under **Zone Resources**, pick only the zone you'll use. Set the token to expire in a day.

The [API token](cloudflare/api-token.md) page explains what each permission is for. If the installer later says
the Cloudflare login method is missing, see [that case](cloudflare/api-token.md#if-the-login-method-is-missing).

## 3. Run the installer

```bash
./install.sh
```

It asks three questions:

- **Hostname**, for example `term.example.com`.
- **Who may log in.** Start with just yourself: `you@example.com:youruser`. That's the email of your Cloudflare
  account, then your Linux username.
- **The API token** from step 2.

It then creates the tunnel, the login method, the Access application and the DNS record on Cloudflare, and
starts two services on your server: the app and the tunnel. Both start on boot, and it links the
`cloudflare-tmux` command into `~/.local/bin`.

For scripts, every answer can be a flag. See [Settings and files](configuration.md#installsh-flags).

## 4. Open it

Go to `https://term.example.com` and sign in with your Cloudflare account. Create a session and start working.
Close the tab whenever you like. The session keeps running.

## 5. Delete the API token

Delete the token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
Nothing that's running uses it. You'll create a new one only when you
[change something on Cloudflare](cloudflare/api-token.md#when-you-need-it), such as adding a person.

## Day to day

```bash
cloudflare-tmux status                       # is it online?
cloudflare-tmux add carol@example.com carol  # let someone log in
cloudflare-tmux doctor                       # something wrong? it tells you the fix
```

## Next

- **Add people.** One invite in the Cloudflare dashboard and one command. See [Add a person](add-a-person.md).
- **Learn the screen.** [Using it](usage.md) covers the dashboard, copy and paste, and the phone key bar.
- **Something wrong?** Run `cloudflare-tmux doctor`, then see [Troubleshooting](troubleshooting.md).
  Re-running `./install.sh` is always safe.
- **Later: secure it further.** Your Cloudflare account is now a key to a shell. The
  [security checklist](security.md#hardening-checklist) takes about ten minutes.
