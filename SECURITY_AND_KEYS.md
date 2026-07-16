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

## Netlify Basic-Auth credentials

Access control at the CDN level uses a Netlify Basic-Auth rule. This used
to be a literal `Basic-Auth: paul:REPLACE_ME_1 colleague2:REPLACE_ME_2
colleague3:REPLACE_ME_3` line committed straight into
`frontend/public/_headers` — meaning every clone or shared zip of this
repo shipped a documented, guessable access gate (flagged P0 in the 15 Jul
2026 Commercial Readiness Audit).

`frontend/public/_headers` is now permanently credential-free. The real
Basic-Auth rule is generated at build time by
`frontend/scripts/generate-headers.mjs` (runs automatically as the second
step of `npm run build`, after `vite build`) from the
`NETLIFY_BASIC_AUTH_CREDENTIALS` environment variable, and is written only
into `dist/_headers` — `dist/` is gitignored and never committed.

- Set `NETLIFY_BASIC_AUTH_CREDENTIALS` in Netlify: **Site settings →
  Environment variables** (or your CI's secret store). Format:
  `"user1:pass1 user2:pass2"` — space-separated `user:pass` pairs, each
  password at least 12 characters. The generator refuses to build if the
  variable is unset, contains a leftover `REPLACE_ME` value, or any
  password is under 12 characters.
- This is deliberately **not** a `VITE_`-prefixed variable — Vite inlines
  `VITE_*` vars into the client bundle, which would leak the password to
  every visitor before they've authenticated. Keep it a build/CI-only
  variable.
- For a genuinely local/throwaway build where no gate is needed, run
  `npm run build:no-auth-gate` instead — this explicitly ships without
  Basic-Auth and prints a warning. Never deploy that build to a shared or
  public URL.
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
from the project entirely on 1 Jul 2026 in favour of Netlify Basic Auth
as the access gate (see `docs/conductor-web-context.md`), which resolves
this finding by elimination rather than deferral. `@clerk/clerk-js` is no
longer a dependency anywhere in this repo.

**Revisit this if:** Clerk, or any other auth provider with a similar
optional-feature dependency bundling pattern, is reintroduced in future —
run a fresh `npm audit` as part of that work rather than assuming this
note still applies.
