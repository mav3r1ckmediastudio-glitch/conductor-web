# Conductor Web — TODO / Parked Work

> Open items with enough context to pick up cold. Newest decisions at the top of each item.
> Convention: **Blocked** = needs something external before it can start. **Ready** = can be done anytime.

---

## Recently shipped (for context)

- **appVersion stamp made effective** (16 Jul 2026) — the version stamped into every saved project file was always `"0.0.0"` because `package.json` was never bumped off the Vite scaffold default, so the "which build wrote this file" signal was dead. Two changes: `package.json` version → `0.1.0` (a real starting semver), and `vite.config.js` now appends an automatic build identifier — the short git commit SHA when built from a checkout (`git rev-parse --short HEAD`), falling back to the build date (`YYYY-MM-DD`) when there's no repo (e.g. an extracted zip). `__APP_VERSION__` is now e.g. `0.1.0+a1b2c3d`, and no manual bumping is required for it to stay unique per build. This closes the "real build ID" item that was parked. (`SCHEMA_VERSION` was already effective at `1` and is unchanged — separate concern.)
- **mapTools.js decomposed** (16 Jul 2026, follow-on to the App.svelte refactor) — 3,292 → an 8-file set, behaviour-preserving, with `mapTools.js` kept as a thin (58-line) re-export **facade** so App.svelte, `mapLayers.js` and `mapSearch.js` need zero edits (every one of the original 36 public exports is re-exported unchanged from its new home). New modules, each cohesive: `mapGeom.js` (pure geometry / GeoJSON helpers — `emptyFC`, `pointFC`, `pointInPolygon`, `haversine`, `haversineChain`, `compassLeg`, `_distToSegment`; no store, no side effects), `mapIds.js` (the 12 `next*Id` generators + directional base tables + `cbtsWithTail`/`CBT_TAIL_MAX_M`), `mapSources.js` (icon rasters, `ensureSources`/`ensureTerrainLayers`, the `_lastSynced` immutable-ref sync cache + `syncToMap`, cable-pulse animation, and the lazy 3D `PoleLayers` load — still code-split into its own chunk, confirmed by the build), `toolSession.js` (the shared `_activeTool`/`_activeSession` state, `clearTool`, `startToolSession`/`endActiveSession`, search-marker layer), `mapPick.js` (`_snapToNode`, point/line hit-testing, connected-set expansion, select + move-point tools), `mapDrawTools.js` (all 14 `activate*Tool` digitisers + the span-graph routing helpers), and `fibreOverlays.js` (trace + count highlight layers/tools). The one non-mechanical change: the 16 activators used to assign the module-global `_activeTool` directly; since an imported binding can't be reassigned, they now call a new `setActiveTool()` exported from `toolSession.js` — the single owner of that state. No import cycles (`mapGeom` is a leaf; `mapDrawTools`/`fibreOverlays` sit on top). Verified: full vitest suite **259 passing** (216 prior + **43 new** unit tests for the now-testable `mapGeom` and `mapIds` — `mapGeom.test.js`, `mapIds.test.js`), and a clean `vite build`. E2E harness (the real safety net for this) runs in CI as before.
- **Cascade-delete on `deleteAsset`** (`cascadeDelete.js`, `assetSchema.js`) — deleting an asset now cleans up every dependent record (cables/spans by endpoint, bundles/drops/tails, fibre assignments) instead of leaving dangling FK refs. Root cause of the "402 Broken connectivity errors" on SCOT-PH1.
- **Project repair sweep** (`repairProject.js`, Design Health "⚕ Scan & Repair") — one-time cleanup of pre-existing dangling refs saved before the cascade fix. Cleared 202 orphaned fibre assignments on SCOT-PH1 (402 → 0 blocking). Dry-run preview → confirm flow.
- **Stale-splitter false positive fix** (`designHealth.js` `feedsAnotherSplitter`, ~line 318) — now also checks `cbtTails` (`to_joint`/`from_cbt`, reverse feed direction) and `spans` (separate collection from cables), not just `cables`. Clears the false "Stale splitter declaration" caution on `SCOT-PH1-JNT-001`. Two new regression tests added.
- **Netlify Personal access gate fixed** — `frontend/public/_headers` carries no credentials, and no longer pretends an unsupported custom `Basic-Auth` header protects a Personal-plan site. `frontend/netlify/edge-functions/basic-auth.js` now gates every path at runtime using the secret `NETLIFY_BASIC_AUTH_CREDENTIALS`; the postbuild script validates the same configuration. See SECURITY_AND_KEYS.md.
- **Versioned project-file validation** (`projectSchema.js`, new) — `schemaVersion`/`appVersion` now stamped on every save (localStorage autosave and `.conductor` file writes). `load()` and `loadExternalState()` validate structure before merging instead of a blind shallow merge: malformed collections are repaired to safe defaults with a warning toast, a file from a newer schema version than this app understands is rejected outright with a clear error, and a corrupt/non-object file is rejected rather than silently becoming the live project.
- Test suite at 199 passing (14 -> 16 test files; +2 stale-splitter regression tests, +33 across new projectSchema.test.js and projectStoreValidation.test.js).
- Test suite now at 216 passing (17 files; +17 mapSearch tests) plus 10 executed-and-passing Playwright E2E tests.
- **First-slice Playwright E2E harness** (`frontend/tests/e2e/`, `playwright.config.js`) — addresses the audit's "Add Playwright smoke journeys" P0 and is the real prerequisite for safely refactoring App.svelte/mapTools.js (2,346 / 3,292 lines, currently zero behavioural test coverage — see "Maintainability" discussion, 16 Jul 2026). 4 tests: app boot, map initialises with no real MapTiler key/network (new `VITE_TEST_MODE` blank-style shim in App.svelte), project-setup happy path, project-setup validation path. Runs as a separate CI job (`.github/workflows/test.yml`, `e2e`). See `frontend/tests/e2e/README.md` for two real gotchas hit building this: the File System Access API's native save/open picker hangs an unstubbed test (fixtures.js works around it), and ProjectSetup.svelte's `<label>`s aren't programmatically associated with their inputs.
- **App.svelte decomposed** (16 Jul 2026, same session as the E2E harness) — 2,359 → 1,627 lines, behaviour-preserving. Extracted, each with its markup + scoped styles + minimal local state: `TopBar.svelte` (stats strip, action buttons, search, 2D/3D toggle, FSAA controls, export + project menus — owns its dropdown state and search text; everything else dispatches up), `Sidebar.svelte` (workflow steps, tool categories, asset tools, layer toggles, basemap switcher — fully presentational), `RoutesDrawer.svelte` (owns open/filter/search state + CSV export), `ValidationSummaryPanel.svelte` (default right-panel content, hosts AssetEditPanel and forwards its events), `FibreAssignPanel.svelte`, `ActiveToolChip.svelte`, `SaveNudge.svelte`. Logic extracted to plain modules: `mapLayers.js` (setupMapLayers — the full custom source/layer/terrain rebuild, now taking explicit options instead of closing over component state) and `mapSearch.js` (postcode/asset search + projectBounds/fitToProject, pure matching split from camera side effects — 17 new unit tests in `mapSearch.test.js`). Also removed ~23 provably-dead CSS selectors the extraction exposed (markup they matched moved to AssetEditPanel long ago). App.svelte still owns: the map instance + camera, workflow/stage handlers, the ASSET_CONFIG placement registry and tool sessions, the rpMode panel switch, FSAA wiring, export orchestration, and project switching. mapTools.js (3,292 lines) deliberately NOT touched — that's its own future session, now with a real harness behind it.
- **E2E suite executed for real this time** — the libXdamage blocker was worked around in-sandbox (user-space extraction of the missing library; CI's `--with-deps` makes this a non-issue there), so all 10 Playwright tests (4 smoke + 6 new refactored-UI tests in `refactored-ui.spec.js`) have actually PASSED against the refactored app in headless Chromium. Three fixes came out of first execution, all documented in `tests/e2e/README.md`: (1) specs must click through the SplashLogin entry screen — `gotoApp()` now does; (2) `map.loaded()` is never true in this app (continuous GeoJSON sync) — wait on `getSource('chambers-src')` instead; (3) `mapLayers.js` now skips the terrain DEM source when no MapTiler key is set, which also stops a misconfigured production deploy from hammering a guaranteed-401 tile URL.
- **Sandbox verification note (16 Jul 2026):** config and all 4 specs parse/discover correctly (`playwright test --list`), and a real Chromium downloads via `playwright install`. Could NOT get a full pass/fail signal in the agent sandbox used to build this — headless Chromium SIGSEGVs there on a missing system library (`libXdamage.so.1`) that the sandbox has no root access to install; `playwright install --with-deps` (used in CI) installs exactly this and is expected to work fine on GitHub Actions' `ubuntu-latest` runners and on a normal dev machine. Treat the FIRST real CI run of the `e2e` job as this suite's actual maiden voyage — a selector mismatch surfacing there would be normal test bring-up, not a sign of sloppy work.

---

## 1. Feeder-port count — ✅ RESOLVED (no action)

Confirmed **2/4 is correct** for a 1:4 splitter feeding 2 CBT tails.

The 1:4's ports are its **split legs** (the tail feeds to downstream 1:8s), not the through-fibres. An aerial span leaving the splitter joint does **NOT** consume a feeder port — it's the physical onward route for through-fibres, not a split leg. No code change needed. Recorded here so it isn't re-raised.

---

## 2. Stale-splitter false positive — ✅ RESOLVED (16 Jul 2026)

**Symptom:** Design Health flagged `SCOT-PH1-JNT-001` (a valid 1:4 feeding two 1:8 CBTs via tails) with a "Stale splitter declaration" caution — `has_splitter` set but "feeds no premises or downstream splitters."

**Cause:** `feedsAnotherSplitter` in `designHealth.js` (~line 318) only inspected `store.cables` when deciding whether a joint feeds something downstream. It ignored:
- **CBT tails** (`cbtTails`: `to_joint` → `from_cbt`) — the actual feed path on JNT-001.
- Aerial **spans** to a downstream splitter.

So a splitter fed purely via tails/spans looked "stale" when it wasn't. Same *class* of bug as the delete issue: logic that only knew about *some* of the ways assets connect.

**Fix shipped:** `feedsAnotherSplitter` now also returns true when a CBT tail has `to_joint === id` and `from_cbt` resolves to a real CBT, and when a span connects `id` to a downstream splitter joint/CBT. Two regression tests added in `designHealth.test.js` — the JNT-001-fed-by-tails case and a span-fed case. Contained — did not touch allocation.

---

## 3. Demand-driven through-splicing — DONE (v0.1.0-beta.2)

**Status:** Implemented and released in the demand-driven planner. Superseding the
capacity-fill `Math.min(fc, partner.fibre_count)` behaviour that was the original bug.

**The design rule (confirmed):** at a joint where the underground feeder meets an onward
aerial cable, splice through **only as many fibres as downstream actually needs**, and
dark-store the remainder in the joint. **Demand-driven, NOT capacity-fill.**

**SCOT-PH1 JNT-001 golden result:** 96F arrives, 1 fibre taps the 1:4 input, nothing exists
past the poles → **1 tap, 0 through, 95 dark**. Encoded as a golden fixture (spec §11) and
passing.

**How it was built (pure, testable modules):**
- `fibreNetwork.js` — POP-rooted directed fibre graph (cables, spans, CBT tails); rejects
  cycles, ambiguous multi-feeders, duplicate segment ids, bad capacities.
- `fibreDemand.js` — post-order demand pass; a splitter consumes 1 input fibre, only
  PASS_THROUGH branches propagate raw demand; capacity is a `CapacityError` that throws,
  never a `Math.min` clamp.
- `fibrePhysicalPlan.js` — deterministic allocation; colour-preserving numbering by default
  (Gigaloch policy §4), compact optional; frozen installed fibres pinned (in and out).
- `fibrePlanValidation.js` — conservation / uniqueness / bounds / topology invariants
  (spec §10); inferred feed_mode at a splitter fails closed.
- `fibrePlanner.js` — two-pass orchestration; a plan is `VALIDATED` only when every
  invariant passes.

**Lifecycle safety (release audit, beta.2):** the export gate is bound to a fingerprint of
the plan inputs, so a validated plan stops being exportable the moment topology/capacity
changes; project schema is v2 with a v1→v2 migration that forces old projects to UNVERIFIED
until replanned.

**Remaining follow-ups (P1, from the beta audit):** branch-classification UI for `feed_mode`
/ `splitter_id` / `splitter_port` (so engineers don't hand-edit JSON); browser lifecycle E2E
(assign → export enabled → edit → export disabled); and sign-off of the golden fixtures
against representative real projects by the responsible network engineer.

---

## 4. Import + georeference a map (PDF/PNG/JPG) — READY, not started, low priority (15 Jul 2026)

**Ask:** import a reference image (Openreach/BT/OS GeoPDF, a scanned paper plan, or a hand-drawn sketch) and place it correctly on the live map, so it can be traced/built over.

**Reality check on "auto":** true zero-click georeferencing only works when the file already carries embedded coordinates (GeoPDF, GeoTIFF, or an image with a `.tfw`/`.jgw`/`.pgw` sidecar). A flat scan or a hand sketch has no coordinates inside it to detect — nothing for "auto" to find. Verified there is currently **zero** image-overlay/georeferencing code anywhere in this codebase; this is new ground, not an extension of something existing.

**What's already in our favour:**
- `mapli
