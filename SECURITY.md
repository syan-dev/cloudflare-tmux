# Security policy

cloudflare-tmux exposes a shell on the web, so we take security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/syan-dev/cloudflare-tmux/security/advisories/new).
Include steps to reproduce, the affected version or commit, and the impact. You should get a reply within a few days.

## Scope

In scope: authentication or authorization bypass in the app (JWT verification, `IDENTITIES` mapping,
same-origin checks), privilege escalation in multi-user mode, command injection, and insecure defaults in the setup scripts.

Out of scope: a compromised Google or Cloudflare account, misconfigurations made by hand outside the
scripts, and anything the mapped Linux user can already do.

## Supported versions

Only the latest release on `main` gets fixes.

See the [security model](https://syan-dev.github.io/cloudflare-tmux/security.html) for how the layers fit together.
