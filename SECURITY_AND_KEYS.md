# Security and API Key Notes

## Environment files

Do not commit real environment files or production secrets to the repository. This repo includes:

```text
frontend/src/.env.example
```

Use it as a template only. Each deployment should provide its own real environment values outside version control.

## MapTiler API key

Conductor Web uses a frontend-visible MapTiler key. In browser applications, this kind of key will be visible to users through the compiled JavaScript bundle and network requests. That is normal for client-side map apps, but the key must be restricted.

Recommended controls:

- Restrict the key to allowed production domains.
- Use separate keys for local development, staging, demos, and production.
- Rotate the key if it has been shared in a zip, committed to git, or sent to a third party.
- Monitor usage for abnormal traffic.
- Do not use a high-privilege account key in the frontend.

## Netlify Edge Basic Auth credentials

Netlify's custom `Basic-Auth` response header is a Pro/Enterprise feature;
it is not an access gate on the Personal plan. Conductor Web therefore gates
every deployed path with `frontend/netlify/edge-functions/basic-auth.js`.
The function runs at Netlify's edge before the app is returned and fails
closed with HTTP 503 if its secret is missing or malformed.

An earlier release generated a `Basic-Auth` line in `dist/_headers`. Netlify
could report that header as processed while still not enforcing it on a
Personal-plan site, creating a dangerous false sense of protection. The
postbuild script now validates the credential configuration only; it does
not emit that unsupported header. `frontend/public/_headers` remains
permanently credential-free.

- Set `NETLIFY_BASIC_AUTH_CREDENTIALS` in Netlify's **Environment
  variables** page. Mark it as a secret and include at least the **Builds**
  and **Functions** scopes. Format:
  `"user1:pass1 user2:pass2"` — space-separated `user:pass` pairs, each
  password at least 12 characters. Both the build validator and runtime gate
  reject a missing value, a leftover `REPLACE_ME`, or a password under 12
  characters.
- This is deliberately **not** a `VITE_`-prefixed variable — Vite inlines
  `VITE_*` vars into the client bundle, which would leak the password to
  every visitor before they have authenticated. Keep it server-side only.
- For local tests or CI where the Netlify secret is unavailable, run
  `npm run build:no-auth-gate`. This skips only the build-time validation;
  the deployed Edge Function still fails closed without its runtime secret.
- After every production or preview deploy, open its URL in a new private/
  incognito browser window. A username/password prompt must appear before
  any app content. Treat a direct app load as a failed release gate.
- Treat these as real secrets: unique per deployment, rotated on staff
  change, never re-used across customer deployments, never pasted into
  chat/email/tickets in plaintext, never included in a shared zip of this
  repo.
- This gate is a P0 stopgap appropriate for a tightly controlled paid
  beta (per the audit), not a substitute for named-user
  authentication/roles/MFA at Gate B (single-organisation production) or
  Gate C (multi-customer SaaS).

## Repository hygiene

Before pushing or sharing the repo, confirm that these are not included:

- `.env` or `.env.*` files containing real secrets.
- `.git` folders from exported zips.
- `node_modules/`.
- Python `venv/` folders.
- `__pycache__/` files.
- Customer data, real premises data, live network data, credentials, tokens, or API logs.

## Build/deployment recommendation

For commercial deployments, prefer environment variables managed by the host/platform rather than committed config files.

## npm audit findings — Clerk Web3 wallet dependency tree (resolved 1 Jul 2026, by removal)

`npm audit` on a clean install used to report 16 vulnerabilities (11
moderate, 5 high), all tracing through `@clerk/clerk-js`'s bundled Web3
wallet login support (Solana, Coinbase Wallet, MetaMask) — specifically its
transitive `viem`/`ws`/`uuid`/`jayson` dependency chain. Conductor Web never
used, enabled, or exposed Web3/wallet authentication anywhere; this was
Clerk shipping a feature surface the app never called.

At the time this was reviewed, the decision was to leave the dependency
as-is rather than force an unvalidated fix — see repo history
(`ab4bd5a`) for the original reasoning. Clerk was subsequently removed
from the project entirely on 1 Jul 2026 in favour of an edge-level Basic
Auth gate (see `docs/conductor-web-context.md`), which resolves
this finding by elimination rather than deferral. `@clerk/clerk-js` is no
longer a dependency anywhere in this repo.

**Revisit this if:** Clerk, or any other auth provider with a similar
optional-feature dependency bundling pattern, is reintroduced in future —
run a fresh `npm audit` as part of that work rather than assuming this
note still applies.
