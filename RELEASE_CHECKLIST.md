# Conductor Web Release Checklist

Use this before pushing the repo to GitHub, sharing a customer demo, or preparing a commercial deployment.

## Repository

- [ ] Repo is private unless intentionally publishing a public demo.
- [ ] `.git`, `node_modules`, `venv`, `__pycache__`, and build output are not included in release zips.
- [ ] Real `.env` files are not committed.
- [ ] `frontend/.env.example` exists and contains placeholders only.
- [ ] `frontend/package.json` says `"private": true` and `"license": "UNLICENSED"`.
- [ ] Root `LICENSE` is present and proprietary.
- [ ] `THIRD_PARTY_NOTICES.md` is present.
- [ ] `ATTRIBUTION.md` is present.
- [ ] `COMMERCIAL_EULA_TEMPLATE.md` has been reviewed before being sent to customers.
- [ ] `NETLIFY_BASIC_AUTH_CREDENTIALS` is set in the deploy platform's environment variables (unique per deployment, 12+ char passwords) — see SECURITY_AND_KEYS.md. `frontend/public/_headers` itself must never contain real credentials.
- [ ] Build was run via `npm run build` (not `build:no-auth-gate`) for anything reachable outside your own machine, and `dist/_headers` was spot-checked to contain a real Basic-Auth rule before deploy.

## Mapping

- [ ] MapTiler key is restricted to allowed domains.
- [ ] Separate development/staging/production MapTiler keys are used where possible.
- [ ] Visible attribution remains present on all maps.
- [ ] Attribution includes MapTiler and OpenStreetMap contributors where required.
- [ ] Any future Mapbox, Ordnance Survey, aerial imagery, or address-data providers are added to third-party notices.

## Commercial

- [ ] Customer licence/EULA has been tailored for the deal.
- [ ] Seat count, company scope, deployment scope, and licence term are written down.
- [ ] Payment, support, updates, hosting, and SLA expectations are written down.
- [ ] Liability cap and warranty wording have been reviewed by a solicitor.
- [ ] Customer-data ownership and data-protection responsibilities are clear.

## Technical

- [ ] App builds successfully from a clean checkout.
- [ ] Backend dependencies are recorded in `requirements.txt` or `pyproject.toml` before commercial deployment.
- [ ] No customer/live network data is included in the repo.
- [ ] Demo data is clearly fictional or cleared for use.
- [ ] README explains how to configure environment variables without exposing secrets.
- [ ] `SCHEMA_VERSION` in `frontend/src/projectSchema.js` was bumped if this release renamed/removed a project-file field or changed a required type (see that file's header comment for what does/doesn't need a bump).
- [ ] `npm run test:e2e` (Playwright, `frontend/tests/e2e/`) passes, not just `npm test` (vitest) — they cover different things; vitest never touches App.svelte/mapTools.js.
