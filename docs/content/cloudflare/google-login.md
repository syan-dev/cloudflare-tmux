---
title: Google login
description: Create a Google OAuth client and add Google as a login method in Cloudflare Zero Trust.
---

# Google login

Cloudflare Access needs a Google **OAuth client** so it can sign people in with Google. You only do this
once per Zero Trust account. Every Access application, including future ones, can reuse it.

> [!TIP]
> Already have Google under **Zero Trust → Settings → Authentication → Login methods**? Skip this page.
> The setup script finds and uses the existing Google login method.

You need your **team domain**, `<team>.cloudflareaccess.com`. Find it in Zero Trust under **Settings → Custom Pages** (or **Settings → General**).

## 1. Create the OAuth client in Google Cloud

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project
   (for example `cloudflare-access`).
2. Go to **APIs & Services → OAuth consent screen** (shown as **Google Auth Platform → Branding** in newer consoles):
   - User type: **External** (or **Internal** if every user is in your Google Workspace).
   - App name: anything, for example `Cloudflare Access`. Add your support email.
   - Under **Audience**, either **publish** the app or add each person's Gmail as a **test user**.
     While the app is in testing, only test users can sign in.
   - No extra scopes are needed. The defaults (`openid`, `email`, `profile`) are enough.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<team>.cloudflareaccess.com`
   - Authorized redirect URIs: `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`
4. Click **Create** and copy the **Client ID** and **Client secret**.

> [!WARNING]
> The redirect URI must match exactly, including `https://` and the `/cdn-cgi/access/callback` path. A
> mismatch shows Google's `redirect_uri_mismatch` error when you try to sign in.

## 2. Add Google to Cloudflare

Choose one of these:

### Option A: let the installer do it

When `./install.sh` asks *"Enter a Google OAuth client ID/secret now?"*, answer `y` and paste both values.
They're saved to `~/.cloudflare-tmux-google-oauth` (mode `600`, line 1 = client ID, line 2 = secret), and
`scripts/cloudflare.sh` creates the Google login method through the API if none exists yet.

You can also create the file yourself before running the scripts:

```bash
(umask 077; printf '%s\n%s\n' 'CLIENT_ID' 'CLIENT_SECRET' > ~/.cloudflare-tmux-google-oauth)
```

### Option B: in the dashboard

1. Zero Trust → **Settings → Authentication → Login methods → Add new → Google**.
2. Paste the client ID and secret and save.
3. Click **Test** next to the new login method. You should see a success page showing your Google identity.

## 3. Check it

After installation, opening your hostname should send you straight to Google's sign-in page, because the
Access application has `auto_redirect_to_identity` set and Google is its only login method. If you see
Cloudflare's own login page with several options instead, see [Troubleshooting](../troubleshooting.md).
