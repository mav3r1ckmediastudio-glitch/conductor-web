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
