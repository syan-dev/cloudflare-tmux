---
title: Add a person
description: Let someone else log in. Invite them in Cloudflare, run one command, and send them the link.
---

# Add a person

Every person has two identities. Their **Cloudflare account email** is what they log in with. Their
**Linux user** on your server is what their shell runs as. Adding a person means connecting the two.

The whole job is one dashboard invite and one command. It takes about five minutes.

## 1. Invite them to your Cloudflare account

They need their own Cloudflare account. A free one is enough, and they can create it when they accept.

1. Open [dash.cloudflare.com](https://dash.cloudflare.com) and sign in with **your** account.
2. In the left sidebar, click **Manage Account**, then **Members**.
3. Click **Invite**.
4. Enter the email of **their** Cloudflare account.
5. Under role, pick **Minimal Account Access** and nothing else. It makes them a member without letting them
   see or change your zones, tunnels or Access settings. Never give them Administrator or a Zero Trust role.
6. Click **Invite**.

They get an email. Ask them to accept it. In the Members list their status changes from **Pending** to
**Accepted**. Cloudflare refuses them until then.

> [!NOTE]
> After accepting, their dashboard may open on **your** account, where almost everything is locked for them.
> That's expected. The **account switcher** at the top takes them back to their own account.

## 2. Create an API token

The command changes the list of allowed people on Cloudflare, so it needs a token. The token is used once and
never saved.

1. Open [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Click **Create Token**, then **Get started** next to **Create Custom Token**.
3. Name it, for example `cloudflare-tmux`.
4. Under **Permissions**, add four rows. Use **+ Add more** for each.

   | Scope | Permission | Access |
   |---|---|---|
   | Account | Cloudflare Tunnel | Edit |
   | Account | Access: Apps and Policies | Edit |
   | Account | Access: Organizations, Identity Providers, and Groups | Read |
   | Zone | DNS | Edit |

5. Under **Account Resources**, include your account.
6. Under **Zone Resources**, include only the zone of your hostname.
7. Under **TTL**, set the **start date to today** and the end date to tomorrow. A start date of tomorrow makes
   every call fail.
8. Click **Continue to summary**, then **Create Token**. Copy it now. Cloudflare shows it once.

## 3. Run the command

On your server, in the `cloudflare-tmux` directory:

```bash
./install.sh add carol@example.com carol
```

- The first argument is their Cloudflare account email.
- The second is the Linux user they get. Leave it out to map them to your own user. People on the same Linux
  user share its tmux sessions. For a user of their own, create it first with `sudo adduser carol`.

The command prints the steps above as a reminder, then asks for the token. It adds the person to your list,
updates Cloudflare, and restarts the app.

If the Linux user is not your own, the app must run as root to start a shell as that user. The command
explains this, asks once, and switches the app to a root service. That needs `sudo`. Your sessions and
settings are kept. See [Multi-user install](install/multi-user.md) for what changes.

## 4. Delete the token

Go back to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) and delete
it. Nothing that runs uses it.

## 5. Send them the link

Send them `https://term.example.com` and the [Usage](usage.md) page. Here is what they see:

1. Cloudflare's login page with one button, **Sign in with Cloudflare**. They sign in with their own account.
2. The dashboard, empty at first. They type a name and click **New session**.
3. A terminal, running as their Linux user. Closing the tab keeps the session running.

Ask them to turn on **two-factor authentication** in their Cloudflare profile, under **My Profile →
Authentication**. Their Cloudflare account is now a key to a shell on your server.

## If they can't get in

| They see | Cause | Fix |
|---|---|---|
| "Cloudflare sign-in is restricted to members of the account" | They haven't accepted the invitation, or signed in with a different Cloudflare account. | Check **Manage Account → Members** shows them as Accepted. |
| Cloudflare's "Access denied" page | Their email isn't in the Cloudflare policy. | Run `./install.sh add` again with a token. |
| "Not signed in" page from the app | The app's list doesn't have them, or the mapping is wrong. The page says what to ask you for. | Run `./install.sh list` to check, then `./install.sh add`. |

When in doubt, run `./install.sh doctor` on the server. It checks every mapped person, both services and the
public URL, and prints the fix next to anything wrong. More in [Troubleshooting](troubleshooting.md).

## Do I need a token every time?

To add someone, yes. To do almost anything else, no.

There are two lists of allowed people, and both must have the person:

1. **Cloudflare's list**, in the Access policy. Cloudflare checks it before the request reaches your server. Only
   the API can change it, so changing it needs a token. The token is never saved, so each change needs a new one.
2. **The server's list**, `IDENTITIES` in the config file. The app checks it and maps the email to a Linux user.
   Changing it needs no token, only a restart, which `./install.sh add` and `remove` do for you.

| Task | Token? |
|---|---|
| Add a person | **Yes.** Their email must go into Cloudflare's list. |
| Remove a person | No. The server refuses them at once. Cloudflare's list is tidied the next time you run with a token. |
| Move an existing person to a different Linux user | No. Only the server's list changes. |
| See who may log in, or run `doctor` | No. With a token, `doctor` also compares the two lists. |
| Restart, update, reboot | No. |

**Adding several people.** Create one token, export it, add everyone, then delete the token:

```bash
read -rs CF_API_TOKEN && export CF_API_TOKEN   # paste the token, nothing is shown
./install.sh add alice@example.com alice
./install.sh add bob@example.com bob
unset CF_API_TOKEN
```

With `CF_API_TOKEN` set, the command doesn't ask for the token.

**Why not keep a token on the server?** Anyone who gets that token could open your terminal to themselves by
adding their own email. A token that lives for an hour and is then deleted can't be stolen later. The
[API token](cloudflare/api-token.md) page explains the permissions and the trade-off in full.

## Remove a person

```bash
./install.sh remove carol@example.com
```

No token needed. The app refuses them from then on, even with a valid Cloudflare login. Later, with a fresh
token, run `scripts/cloudflare.sh term.example.com` to take them out of the Cloudflare policy too. Their tmux
sessions keep running. See [If something goes wrong](security.md#if-something-goes-wrong) for a full cleanup.

## See who may log in

```bash
./install.sh list
```
