# Security Policy

## Supported versions

Loom is pre-1.0 and moves fast. Only the latest release receives security
fixes — please upgrade before reporting.

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Anything older | ❌ |

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private reporting instead:

[**Report a vulnerability →**](https://github.com/HSPK/loom/security/advisories/new)

Include the affected version, the impact, and steps to reproduce. You'll get
an acknowledgement within a few days, and credit in the advisory unless you'd
rather stay anonymous.

## Deployment notes

Loom is designed to be self-hosted, and it stores credentials for every
upstream you register. A few things are worth knowing.

### The master key is the root secret

`LOOM_MASTER_KEY` derives the AES-256-GCM key that encrypts every stored
provider and MCP credential. Anyone with the key *and* the database can
decrypt them all.

- Keep it out of version control. `loom init` writes `loom.config.yaml` with
  `chmod 600`; the container generates one onto its data volume.
- Inject it from your orchestrator's secret store in production — environment
  variables always take precedence over the config file.
- Rotating it makes existing encrypted secrets unreadable. There is no
  re-encryption path yet, so you'd have to re-enter every API key.

### Don't expose Loom directly to the internet

Everything runs under one auth model, and an API key issued for a user works
across the playground, the gateway, and MCP dispatch. If you must expose it,
put it behind a reverse proxy with TLS and set `LOOM_TRUST_PROXY=1` so the
login rate limiter can see real client addresses.

Only set `LOOM_TRUST_PROXY=1` when a proxy you control rewrites
`X-Forwarded-For` — otherwise clients can spoof it.

### MCP servers execute code

stdio MCP servers run as child processes with the environment you configure.
Treat adding one exactly like installing a package: only register servers you
trust.

### The request log contains everything

`generation_logs` stores full prompts and full responses, including anything
sensitive your users send. Protect the database file and the `/logs` page
accordingly, and remember that `data/loom.db` in a backup is a complete copy
of that history.
