# Conductor Web — TODO / Parked Work

> Open items with enough context to pick up cold. Newest decisions at the top of each item.
> Convention: **Blocked** = needs something external before it can start. **Ready** = can be done anytime.

---

## Recently shipped (for context)

- **Cascade-delete on `deleteAsset`** (`cascadeDelete.js`, `assetSchema.js`) — deleting an asset now cleans up every dependent record (cables/spans by endpoint, bundles/drops/tails, fibre assignments) instead of leaving dangling FK refs. Root cause of the "402 Broken connectivity errors" on SCOT-PH1.
- **Project repair sweep** (`repairProject.js`, Design Health "⚕ Scan & Repair") — one-time cleanup of pre-existing dangling refs saved before the cascade fix. Cleared 202 orphaned fibre assignments on SCOT-PH1 (402 → 0 blocking). Dry-run preview → confirm flow.
- Test suite at 164 passing.

---

## 1. Feeder-port count — ✅ RESOLVED (no action)

Confirmed **2/4 is correct** for a 1:4 splitter feeding 2 CBT tails.

The 1:4's ports are its **split legs** (the tail feeds to downstream 1:8s), not the through-fibres. An aerial span leaving the splitter joint does **NOT** consume a feeder port — it's the physical onward route for through-fibres, not a split leg. No code change needed. Recorded here so it isn't re-raised.

---

## 2. Stale-splitter false positive — READY (safe, self-contained)

**Symptom:** Design Health flags `SCOT-PH1-JNT-001` (a valid 1:4 feeding two 1:8 CBTs via tails) with a "Stale splitter declaration" caution — `has_splitter` set but "feeds no premises or downstream splitters."

**Cause:** `feedsAnotherSplitter` in `designHealth.js` (~line 318) only inspects `store.cables` when deciding whether a joint feeds something downstream. It ignores:
- **CBT tails** (`cbtTails`: `to_joint` → `from_cbt`) — the actual feed path on JNT-001.
- Aerial **spans** to a downstream splitter.

So a splitter fed purely via tails/spans looks "stale" when it isn't. Same *class* of bug as the delete issue: logic that only knows about *some* of the ways assets connect.

**Fix:** extend `feedsAnotherSplitter` to also return true when a CBT tail has `to_joint === id` and `from_cbt` resolves to a real CBT (and, for completeness, when a span connects `id` to a downstream splitter). Add a regression test reproducing the JNT-001-fed-by-tails case. Contained — does not touch allocation.

---

## 3. Demand-driven through-splicing — BLOCKED (needs a realistic multi-leg test network)

**The design rule (confirmed):** at a joint where the underground feeder meets an onward aerial cable, splice through **only as many fibres as downstream actually needs**, and dark-store the remainder in the joint. **Demand-driven, NOT capacity-fill.**

**Worked example (SCOT-PH1 JNT-001):** 96F UG cable arrives; the UG and the aerial cable meet and splice **in the same joint that houses the 1:4**. 1 fibre taps the 1:4 input. Of the remaining 95, the number continuing over the poles depends on downstream demand; the rest coil as dark storage. On the current test map nothing exists past the poles, so the *correct* demand-driven answer is **0 through, 95 dark** (or 1 tap + 95 dark). Real answer only computable once legs exist past POL-004.

**Current code behaviour (the bug):** Stage 3 in `fibreAssign.js` **does** walk aerial spans (they're indexed into `cablesByNode` alongside cables — so spans are NOT a blind spot). BUT the through-count is capacity-driven:

```
// fibreAssign.js ~line 494
passThroughLimit = partner ? Math.min(fc, partner.fibre_count) : fc;
```

i.e. it splices through `min(incoming, span capacity)` — e.g. a 48F span off a 96F feeder → 48 through-spliced, 47 dark. That's **capacity-fill**, the opposite of the confirmed rule. It over-commits span fibres regardless of what downstream needs.

**What the fix needs:**
1. A **downstream-demand** function: "how many fibres do all assets reachable past this segment actually require?" — feeding the through-count instead of `min(fc, partner cap)`.
2. Dark-store the remainder (incoming − 1 splitter tap − demand).
3. A realistic **multi-leg test design** (legs continuing past the poles, ideally a second downstream 1:4 / break-out) to validate demand propagation + dark-storage remainder. Cannot be exercised on the current single-CBT-pair test map (downstream demand = 0).

**Scope note:** core allocation change — ripples into splice plan, fibre numbering, optical budget. Do NOT rush; needs its own session + test coverage across assign/splice/optical. Exact line to change is known (`fibreAssign.js` ~494).

---

## 4. Import + georeference a map (PDF/PNG/JPG) — READY, not started, low priority (15 Jul 2026)

**Ask:** import a reference image (Openreach/BT/OS GeoPDF, a scanned paper plan, or a hand-drawn sketch) and place it correctly on the live map, so it can be traced/built over.

**Reality check on "auto":** true zero-click georeferencing only works when the file already carries embedded coordinates (GeoPDF, GeoTIFF, or an image with a `.tfw`/`.jgw`/`.pgw` sidecar). A flat scan or a hand sketch has no coordinates inside it to detect — nothing for "auto" to find. Verified there is currently **zero** image-overlay/georeferencing code anywhere in this codebase; this is new ground, not an extension of something existing.

**What's already in our favour:**
- `maplibre-gl` (already a dependency) has a native `ImageSource` — give it 4 corner `[lng,lat]` pairs and it does the GPU warp itself. No raster-resampling code needed on our side.
- `projectStore.js` already has `proj4` wired for **EPSG:27700 (British National Grid) → EPSG:4326**, which is the CRS most UK utility/OS exports use. Directly reusable.

**Agreed phasing (build order + scope not yet confirmed with Paul — this is a plan, not a spec to start coding from):**
- **Phase A — control-point georeferencer (core).** Upload PNG/JPG/PDF (PDF rasterized via a new `pdfjs-dist` dependency — not in the project today, needs sign-off to add). Click a point on the image, click the matching spot on the live map (or type a known BNG easting/northing for off-screen points). 2 points → similarity transform (scale+rotate+translate); 3+ → least-squares affine, more forgiving of a skewed scan. Feed the fitted 4 corners into MapLibre's `ImageSource`. Opacity slider, toggle, delete, persisted in the project file (new `mapOverlays` collection). Covers every source type Paul mentioned — this alone is the whole feature if nothing else gets built.
- **Phase B — world-file fast path.** If a `.tfw`/`.jgw`/`.pgw` sidecar accompanies the image, parse its 6 numbers directly — skips straight to placement (still nudgeable). Assumes BNG.
- **Phase C — GeoPDF embedded-coordinate fast path.** Openreach/OS GeoPDFs typically embed 4 tie points in an OGC viewport/measure dictionary inside the PDF. Parsing those feeds straight into the same control-point transform from Phase A — reuses that pipeline entirely rather than being a separate code path.

**Paul's own flag, worth designing around:** control-point matching is going to be visually hard on any basemap other than satellite — a scanned technical drawing's roads/building outlines line up naturally against aerial imagery, much less so against a stylised vector/neon-dark basemap. Worth defaulting to (or nudging toward) the satellite basemap when the control-point tool is active, rather than assuming the user will think to switch themselves.

**Status:** parked deliberately — not urgent, sizeable build. Next step when picked back up: confirm build order (A only vs A+B vs all three) and whether `pdfjs-dist` is OK to add, then write the actual implementation spec.

---

## Notes

- Working browser is **Edge** (not Chrome). Confirm browser before assuming.
- SCOT-PH1 test map: 1 cabinet → JNT-001 (1:4) → 2 CBT tails → CBT-001 (1:8, 6 drops) + CBT-002 (1:8, 4 drops) → 10 premises. Aerial spans continue JNT-001 → POL-001 → POL-002 → POL-003 → POL-004 (no downstream assets past the poles yet — this is why item 3 can't be tested here).
