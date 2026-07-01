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

## npm audit findings — Clerk Web3 wallet dependency tree (reviewed 1 Jul 2026)

`npm audit` on a clean install reports 16 vulnerabilities (11 moderate, 5
high). All of them trace through `@clerk/clerk-js`'s bundled Web3 wallet
login support (Solana, Coinbase Wallet, MetaMask) — specifically its
transitive `viem`/`ws`/`uuid`/`jayson` dependency chain. Conductor Web does
not use, enable, or expose Web3/wallet authentication anywhere; this is
Clerk shipping a feature surface the app never calls.

**Decision: leave as-is.** Reasoning:

- The vulnerable code paths are not reachable through anything Conductor
  Web's own code does — this is dead weight, not a live attack surface.
- Web3 wallet login is not togglable out of `@clerk/clerk-js` at a config
  level (confirmed via Clerk's own docs) — the dependency tree is bundled
  unconditionally regardless of whether the Web3 provider is enabled in
  the Clerk Dashboard.
- `npm audit fix --force`'s own suggested resolution (`@clerk/clerk-js@5.89.0`)
  is actually a *downgrade* from the currently-installed, stable `6.23.0`
  — checked directly against the published version list before writing
  this note. Running the automated fix would not be a safe fix; it would
  swap a known, inert finding for an unvalidated dependency combination
  Clerk itself never tested.
- `npm overrides` could force patched versions of the specific vulnerable
  sub-packages without touching Clerk's own version, but this was also
  rejected for the same reason — it produces a dependency graph the
  upstream package never validated, trading a known-inert issue for an
  unknown one.

**Revisit this if:** Web3/wallet login is ever actually enabled for this
app (it shouldn't be — there's no product reason to), or as part of a
routine, deliberate Clerk version bump done as its own dedicated piece of
work with a full auth regression pass — not squeezed into an unrelated
cleanup session, since auth is exactly the kind of thing that shouldn't be
silently affected by a rushed dependency change.
