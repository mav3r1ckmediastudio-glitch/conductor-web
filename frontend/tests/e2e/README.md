# E2E smoke tests (Playwright)

## Why this exists

The 199+ vitest tests in `src/__tests__/` are all pure-logic modules
(`designHealth.js`, `fibreAssign.js`, `projectSchema.js`, etc.). None of
them touch `App.svelte` or `mapTools.js` — the two largest, least-tested
files in the codebase, and the two most people would want to refactor
first. This suite is the start of real coverage for that surface, so a
future refactor of either file has an automated way to know "did I break
the actual click-through-the-app behaviour," not just "did the unit tests
still pass."

It's also one of the P0 items from the 15 Jul 2026 Commercial Readiness
Audit: "Add Playwright smoke journeys for project create/open/save,
drawing, editing, delete, export and map refresh."

## Scope of this first slice

Four tests: app boot, the map initialising without a real MapTiler
key/network, a project-setup form completing successfully, and the same
form rejecting an incomplete submission. Deliberately small — this proves
the harness works end-to-end and covers the one transition every other
journey depends on (setup → import). Extend outward from here one journey
at a time (address import → build area → cabinet → a real map-tool
placement), verified against `npx playwright test --ui` locally rather
than guessed at.

## Four things every new spec needs to know

**1. The File System Access API will hang an unstubbed test.**
Playwright's Chromium implements `window.showSaveFilePicker` /
`showOpenFilePicker` for real. There's no human present to click through
the native OS picker those open, so an unstubbed call hangs the test
(headed) or errors unpredictably (headless). `App.svelte`'s
`onProjectCreated()` calls this automatically right after project
creation whenever `fsaa.isSupported()` is true — which it is by default in
Playwright's Chromium. Always start a spec with `gotoApp(page)` from
`fixtures.js` (not a raw `page.goto()`) — it deletes both picker functions
before any page script runs, so `isSupported()` correctly reports false and
the app takes its normal non-FSAA code path (the same one real Firefox
users hit today). If you're specifically testing the save/open-file flow,
stub the picker functions to resolve with a fake handle instead of
deleting them — don't leave them as Playwright's real implementation.

**2. The app boots to a splash screen, not the app.** `main.js` mounts
`AppGate.svelte`, which shows `SplashLogin` (branding + a "Continue to
Conductor Web" button — deliberately not real auth) and only mounts
`App.svelte` after that click. `gotoApp()` in `fixtures.js` clicks through
it for you — use it, don't `page.goto()` raw. (Found on this suite's first
real execution: every spec that skipped the click saw only the splash.)

**3. Don't wait on `map.loaded()`.** This app never settles it to `true` —
the continuous GeoJSON sync keeps source updates pending. The right map
readiness signal is one of the app's own sources existing:
`window.map.getSource('chambers-src')` proves the `load` event fired AND
`setupMapLayers()` built the full layer stack. (Also found on first real
execution.)

**4. `ProjectSetup.svelte`'s labels aren't programmatically associated
with their inputs** (no `for`/`id`, no wrapping) — `page.getByLabel(...)`
will not find them. Use `getByPlaceholder()` or role-based queries, which
is what actually works against the markup as it exists today. If you're
touching that component anyway, associating the labels properly would be a
small, real accessibility fix (the Commercial Readiness Audit flagged
missing accessibility auditing generally) and would let future tests use
`getByLabel()` like normal — not required for this suite to work, just
worth doing next time that file is open for another reason.

## Running locally

```bash
cd frontend
npm install
npx playwright install --with-deps chromium   # one-time, downloads a real browser
npm run test:e2e            # headless run
npm run test:e2e:ui         # interactive UI mode — best for writing/debugging a new spec
```

`playwright.config.js`'s `webServer` starts the Vite dev server itself
(`VITE_TEST_MODE=1`, activating `App.svelte`'s blank-map-style shim) — you
don't need `npm run dev` running separately first.

## A sandbox-specific gotcha, not a code problem

If you see the *installed* Node binary crash with a V8 `unreachable code` /
`SIGSEGV` under heavy JIT load (this surfaced during development in a
resource-constrained CI-like sandbox, both on `npm install` and on `vite
build`), that's a flaky V8 TurboFan bug in that specific environment's
Node build, not this codebase. Workaround there was invoking Node directly
with `--no-opt` (not settable via `NODE_OPTIONS`, must be a real CLI flag):
`node --no-opt node_modules/.bin/playwright test`. This has not been
observed on a normal machine or GitHub Actions' `ubuntu-latest` runners —
don't add `--no-opt` to the committed scripts/CI on the strength of one
constrained sandbox hitting it.
