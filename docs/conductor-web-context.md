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

The plugin has 34 registered tools. Status below is determined from live source (read June 2026).

### ✅ Working in Conductor Web (10 design tools + onboarding)

**Onboarding (outside wheel — complete):**
- New Project, Open Project, Build Areas, Import Premises (AddressBase), Place Cabinet/POP

**Design tools (wired handler in `App.svelte`):**

| Web tool id | Tool name |
|---|---|
| `civil-chamber` | Place Chamber |
| `civil-duct` | Digitise Duct |
| `civil-drop-duct` | Digitise Drop Duct |
| `fibre-cable` | Digitise Cable |
| `fibre-bundle` | Digitise Bundle |
| `fibre-joint` | Place Joint |
| `aerial-pole` | Place Pole |
| `aerial-cbt` | Place CBT |
| `aerial-span` | Digitise Aerial Span |
| `aerial-drop` | Digitise Aerial Drop |

---

### 🔶 Stubbed — button in wheel, no handler yet (10)

Wire these in `App.svelte` `onToolSelected()` + implement handler. These are the **immediate priority** for "get all design tools functional."

**Tier 1 — digitising stubs (pattern-replication of existing tools, do these first):**

| Web tool id | Tool name | Notes |
|---|---|---|
| `civil-edit-cabinet` | Edit Cabinet/POP | Click cabinet → edit attributes (name, type, equipment, optics, notes) |
| `civil-road` | Road Crossing | Duct segment variant; crossing type attribute; same pattern as Digitise Duct |
| `civil-stream` | Stream Crossing | Duct segment variant; crossing type + wayleave ref; same pattern |
| `aerial-cbt-tail` | Draw CBT Tail | Fibre tail from CBT back to parent underground joint; **hard-stop at 350m** (plugin enforces this; store true length for BoM) |
| `pia-chamber` | Place PIA UG Chamber | PIA variant of Place Chamber |
| `pia-duct` | Digitise PIA UG Duct | PIA variant of Digitise Duct; sets `duct_type = PIA_SUBDUCT` |
| `pia-drop` | Digitise PIA UG Drop | PIA variant of Drop Duct; `installation_method = PIA_UG` |

**Tier 2 — fibre logic stubs (more complex, do after Tier 1):**

| Web tool id | Tool name | Notes |
|---|---|---|
| `fibre-assign` | Assign Fibre Roles | BFS 1:4×1:8 cascade engine; port from `fibre_assign.py` in plugin |
| `fibre-trace` | Fibre Trace | Click premise → trace route back to cabinet, highlight each hop |
| `fibre-count` | Fibre Count | Show fibre utilisation (used / spare / total) per cable segment |

---

### ❌ Not in webapp yet — no button (14)

Analysis, reporting, and asset-editing tools. Implement after the design suite is complete.

**Asset editing (needed early — every working tool produces assets users will want to edit):**

| Plugin tool | Notes |
|---|---|
| Edit Asset | Click any asset → open edit dialog; update attributes; changes committed |
| Move Asset | Click asset → click new location; connected ducts/cables update |
| Delete Asset | Picker shows all assets near click; select which to delete |

**Analysis & reporting:**

| Plugin tool | Notes |
|---|---|
| Validate Fibre Routes | BFS trace from every premise to cabinet; ROUTED / PARTIAL / UNSERVED |
| Bill of Materials | Full BoM from design — chambers, ducts, cables, joints, splitters, CBTs, poles; Excel export |
| Cabinet Cost Calculator | Equipment cost from GPON port count, splitter config, chassis type |
| Single Line Diagram | Schematic view: cabinet → joints → splitters → customers |
| Route Splice Export | Full splice schedule as HTML; every joint from premise to cabinet |
| Splice Plan Export | All fibre assignments across network |
| Fibre Count Calculator | (Same as `fibre-count` stub above — already has a button) |

**Not yet in scope for V1 web:**
- Optical Power Budget (exists in `optical.js` as a calculator, not a map tool)
- Design Health tool (v2 plugin only)
- Survey / wayleave / build_tasks / customers lifecycle layers (explicitly deferred)

---

## Current priority order (agreed)

1. **Wire Tier 1 stubs** — 7 digitising tools (pattern-replication, low risk)
2. **Wire Tier 2 stubs** — 3 fibre-logic tools (BFS port, more complex)
3. **Asset editing** — Edit / Move / Delete (needed for a usable design suite)
4. **Reporting tools** — BoM, SLD, validators, exports
5. **Wants (deferred until suite is robust):** basemap switcher, building geometry toggle, re-import addresses button, premise heights for aerial drops

---

## How to use this doc

1. Paste this at the top of a new chat.
2. State the one tool/task for that chat.
3. Attach only the current files that task touches — typically the relevant tool handler + `App.svelte` dispatch section + `mapTools.js`.
4. Don't paste the whole repo — the shape is already here.
