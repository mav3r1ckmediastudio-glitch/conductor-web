# Conductor Web — Context Primer

> Paste this at the start of a chat so Claude has the project's stable shape without re-explaining it. Then attach only the live files the task actually touches.
> **This doc covers things that rarely change. It does NOT hold live code — send current files for the task itself.**

---

## What it is

Conductor Web is a standalone webapp for FTTP network design, aimed at rural ISPs. Commercial product — affordable alternative to tools like Weezie (~£5k/seat/yr). It is the web port of the Conductor QGIS plugin; the plugin is the authoritative spec.

Built and maintained solo by Paul (Gigaloch, a rural FTTP ISP in Perthshire).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Svelte + Vite |
| Map | MapLibre GL JS v5, MapTiler `dataviz-dark` basemap |
| 3D | THREE.js r185 via MapLibre `CustomLayerInterface` |
| Backend | FastAPI (Python) |
| DB (target) | PostgreSQL + PostGIS on Supabase |
| Hosting | Netlify (frontend) + Railway (backend) |
| Repo | `mav3r1ckmediastudio-glitch/conductor-web`, branch `master` |
| Working dir | `C:\Users\paulw\Documents\conductor-web\frontend` |
| MapTiler key | `frontend/.env` (gitignored) |

---

## Working conventions

- **Complete updated files, not partial diffs or patches.** Always.
- **`syncToMap` is the authoritative writer** for all GeoJSON sources. Never write to sources elsewhere.
- **Vite hot-reload** is the dev loop — no build step needed during development.
- Windows shell: `findstr` not `grep`, `type` not `cat`, full paths always.
- **One task per chat** (token discipline). Send only the 2–3 files a task truly touches.

---

## Data / storage model

- All assets held in an **in-memory GeoJSON store**, persisted to **localStorage**.
- **Multi-project support:**
  - `INDEX_KEY` — project index
  - `ACTIVE_KEY` — current project id
  - `projectKey(id)` — per-project blob
  - Legacy `STORAGE_KEY` migrated on first load
  - Topbar: `+ New` (fresh project, current stays saved), `Open ▾` (lists saved projects, newest first; active = cyan dot)
- **Coordinate transform:** BNG→WGS84 uses **proj4 EPSG:27700→4326 with `+towgs84` datum shift** (sub-2m, matches QGIS). Never reintroduce hand-rolled Airy ellipsoid maths or `+0.0001/+0.0002` fudge offsets — they mask a ~70m datum gap.

---

## Architecture — key files

| File | Role |
|---|---|
| `App.svelte` | Root component; owns `onToolSelected()` dispatch, map init, rpMode state machine |
| `mapTools.js` | All map tool handlers, `syncToMap`, `ensureSources`, `ensureTerrainLayers` |
| `projectStore.js` | In-memory GeoJSON store + localStorage persistence |
| `RadialWheel.svelte` | Tool wheel UI — hub permanent SVG, spokes animate |
| `PoleLayers.js` | THREE.js CustomLayerInterface for 3D poles, CBTs, aerial spans, drops |

---

## Onboarding flow

Project Setup → Address Import (CSV, BNG→WGS84) → Build Area digitiser (cookie-cutter clip) → Cabinet placement.  
Onboarding runs outside the radial wheel; all design tools unlock after cabinet is placed.

---

## Layer ordering

`duct → cables-glow → cables-pulse → dropducts → bundles → rubberband → point assets → labels`

---

## Aerial suite

- **Poles** — `PoleLayers.js`. Float64Array mainMatrix, terrain elevation via `queryTerrainElevation`, axis-swap in L matrix, startup poll for store race condition.
- **CBT** — snaps to POLE, `CBTForm.svelte`, renders as THREE.js `BoxGeometry` cube.
- **Aerial Span** — oriented `CylinderGeometry`; stores 2D coords with `from_node`/`to_node` CBT refs; 3D geometry derived from cached pole-top positions.
- **Aerial Drop** — same cylinder pattern; connects to ONT, angles down to 2D premise icon.

Aerial→layer type mapping mirrors the plugin: poles→chambers, CBTs→joints, aerial spans→cables.

**Map hooks:** `ensureSources()` on map load; `ensureTerrainLayers()` after `map.setTerrain()`.

---

## Radial tool wheel

- Hub SVG is **permanent / never re-rendered** (IR=44, OR=108, CX=0, CY=OR, fans rightward).
- Spokes SVG animates fan from left edge.
- Colours: `#4dc8ff` / `#00aaff`. **No green or teal.**

---

## Known constraints / gotchas

- `shpjs` must be a **static import**.
- `line-elevation-reference` is **not** a real MapLibre GL JS property.
- `map.setStyle()` de-registers THREE.js `CustomLayerInterface` layers — any basemap switch must re-add custom layers in order, not just re-run `ensureSources`/`ensureTerrainLayers`/`syncToMap`.
- Never call `reload_plugin` / `loadPlugin` / `startPlugin` from QGIS `execute_code`.

---

## Tool parity matrix

**Last verified against live source: 2 Jul 2026, commit `b067746`.** Verified by
grepping `App.svelte`'s actual `onToolSelected()` dispatch table and function
definitions — not inferred from commit messages or memory. If this section and
a commit message ever disagree, trust this section only if its "last verified"
commit is equal to or newer than HEAD; otherwise re-verify, don't assume.

The plugin has 34 registered tools.

### ✅ Working in Conductor Web (23 design tools + onboarding + asset editing + reporting)

**Onboarding (outside wheel — complete):**
New Project, Open Project, Build Areas, Import Premises (AddressBase), Place Cabinet/POP.

**Design tools — wired handler in `App.svelte`, confirmed in dispatch table (17):**

| Web tool id | Tool name |
|---|---|
| `civil-chamber` | Place Chamber |
| `civil-duct` | Digitise Duct |
| `civil-drop-duct` | Digitise Drop Duct |
| `civil-edit-cabinet` | Edit Cabinet/POP |
| `civil-road` | Road Crossing |
| `civil-stream` | Stream Crossing |
| `fibre-cable` | Digitise Cable |
| `fibre-bundle` | Digitise Bundle |
| `fibre-joint` | Place Joint |
| `fibre-trace` | Fibre Trace |
| `fibre-assign` | Assign Fibre Roles |
| `fibre-count` | Fibre Count |
| `aerial-pole` | Place Pole |
| `aerial-cbt` | Place CBT |
| `aerial-cbt-tail` | Draw CBT Tail (350m hard-stop enforced) |
| `aerial-span` | Digitise Aerial Span |
| `aerial-drop` | Digitise Aerial Drop |
| `pia-chamber` | Place PIA UG Chamber |
| `pia-duct` | Digitise PIA UG Duct |
| `pia-drop` | Digitise PIA UG Drop |

**Asset editing — confirmed present:** Edit Asset, Move Asset, Delete Asset.

**Analysis & reporting — confirmed present (all as buttons/panels, not wheel tools):**
Validate Fibre Routes, Bill of Materials, Cabinet Cost Calculator, Single Line
Diagram, Splice Plan Export, Route Splice Export (`onDownloadRouteSplice`,
inside the Fibre Trace panel), Design Health (`✓ Health` button, verdict banner).

**"Wants" from the old deferred list — also confirmed present:** basemap
switcher (Dark/Light/Streets/Satellite), building geometry toggle.

**`App.svelte` internal structure:** 15 of the 17 asset-placement handler
triads (`onPlaceX`/`onXSaved`/`onXCancelled`) were collapsed into a generic
`ASSET_CONFIG` registry + `onPlaceAsset`/`onAssetSaved`/`onAssetCancelled`
(commit `fb9e495`, 1 Jul). `BuildArea` and `Cabinet` remain hand-written
(singletons, genuinely different behaviour — same call as declining the
plugin's `LayerManager` extraction). Live-verified in the running app, no
issues found.

---

### ❌ Genuinely not built yet (confirmed absent by grep, not assumption)

| Item | Status |
|---|---|
| Optical Power Budget | `optical.js` exists as a pure calculator (ported from `optical_budget.py`), **no UI panel wires it in** — zero references to "optical" anywhere in `App.svelte` |
| Re-import addresses button | No match for `reimport`/`re-import` in `App.svelte` |
| Premise heights for aerial drops | No match for `premiseHeight`/`premise_height` anywhere |
| Fibre Count Calculator as a standalone report | `fibre-count` exists as a wheel tool only, not a separate report panel |
| Survey / wayleave / build_tasks / customers lifecycle layers | Explicitly out of scope until robust V1 (settled decision, don't re-open) |

---

## Changelog (append here, don't let it go stale — this section is the whole point of this doc)

- **2 Jul 2026** — Continuous digitising mode implemented: point-placement
  tools (chamber, joint, pole, CBT, PIA chamber) and the shared Edit/Delete/
  Move select flow now stay live across repeated actions instead of
  auto-deactivating after one. RMB opens a Save/Cancel popup
  (`SessionConfirm.svelte`) rather than ending silently; Cancel does a full
  session rollback via new `projectStore.snapshotState()`/`restoreState()`
  (deep-clone/restore rather than an action-by-action undo log). Session
  machinery lives in `mapTools.js` (`startToolSession`/`clearTool`), wired
  through App.svelte's `ASSET_CONFIG` registry and the select/edit/delete/
  move handlers. Line tools (duct/cable/aerial span) deliberately untouched
  — out of scope per the 2 Jul decision. 7 new tests
  (`projectStoreSession.test.js`) cover snapshot/restore against adds,
  deletes, geometry moves and property edits. Not yet live-verified in the
  browser. Commit `e20a7dc`.
- **2 Jul 2026** — MapTiler 403 on live deploy fixed: stray leading `=` in
  Netlify's `VITE_MAPTILER_KEY` env var (not a code, account, or billing
  issue). See `docs/conductor-maptiler-403-RESOLVED.md`.
- **2 Jul 2026** — Validation panel (right sidebar) contrast fixed: labels
  were 7.5–8px at `#3a5a70` (≈2.3:1 contrast, under WCAG AA). Bumped to 11px,
  `#6ba3c7`, glow added to section headers matching the existing `.asset-id`
  convention. Commit `b067746`.
- **1 Jul 2026** — App.svelte registry refactor done and live-verified
  (see above). Commit `fb9e495`.
- **1 Jul 2026** — Independent audit (5 items) closed: `.gitignore`/
  `package.json` hygiene, `cabinetCost.test.js`, HTML-escaping helper (2
  real injection bugs fixed), `SECURITY_AND_KEYS.md`, `shpjs` dynamic
  import. Commit `2842bd6`.
- **1 Jul 2026** — Clerk OAuth removed entirely; Netlify Basic Auth via
  `_headers` is now the access gate. Commit `cc82370`.

---

## Current priority order (agreed)

1. **Optical Power Budget UI panel** — the calculator exists, just needs wiring
   into a panel (same pattern as Cabinet Cost Calculator).
2. **Re-import addresses button.**
3. **Premise heights for aerial drops.**
4. Everything else in the old "priority order" (Tier 1/2 stubs, asset editing,
   reporting tools, continuous digitising mode) is **done** — see Tool Parity
   Matrix above.

---

## How to use this doc

1. Paste this at the top of a new chat.
2. State the one tool/task for that chat.
3. Attach only the current files that task touches — typically the relevant tool handler + `App.svelte` dispatch section + `mapTools.js`.
4. Don't paste the whole repo — the shape is already here.

**Maintenance:** at the end of any session that finishes real work, add one
line to the Changelog above and update the Tool Parity Matrix / priority list
if it changed. If Claude isn't sure whether something's actually done, it
should grep the repo (function name, dispatch table entry) rather than trust
a commit message or its own memory of prior chats — both have gone stale
before. This doc existing at all only helps if it's kept current; a wrong
status doc is worse than no status doc.
