# Handoff — Demand-Driven Through-Splicing (Stage 3 quarantine → planner rewrite)

**Date:** 16 July 2026
**Project:** Conductor Web (`frontend/`)
**Primary module:** `frontend/src/fibreAssign.js`
**Status entering this work:** Diagnosis confirmed, blast radius traced, nothing changed yet.

---

## 1. What this is

Stage 3 of `assignFibres()` computes pass-through fibres from **cable capacity**, not
**downstream demand**. The offending line (`fibreAssign.js` ~L494):

```js
const passThroughLimit = partner ? Math.min(fc, partner.fibre_count) : fc;
```

This is capacity-fill: it splices through `min(incoming, partner capacity)` fibres regardless
of what downstream actually needs, over-committing fibres and mis-labelling dark storage. The
confirmed engineering rule is **demand-driven**: splice only the fibres downstream assets
require, dark-store the remainder. See the reference doc for the full spec and golden fixtures.

**Do this in two stages, in order:**
1. **Quarantine** the physical output now (small, safe, makes the beta honest).
2. **Rewrite** the physical planner behind the quarantine (a proper multi-part project).

**Do NOT** attempt a one-line `Math.min` swap — Stage 3 skips the 1:4 feeder cable entirely
(`fibreAssign.js` ~L458) and there is no demand figure computed anywhere to swap in.

---

## 2. The two record classes (single `store.fibreAssignments` array)

| Class | `fibre_role` values | Verdict |
|---|---|---|
| **Logical / port** (correct — keep) | `SPLITTER_INPUT`, `SPLITTER_OUTPUT`, `SPLITTER_OUTPUT_SPARE`, Stage-1 feeder `DARK_STORAGE` | Keep. Also the derived asset fields `splitter_port`, `feeder_port`, `has_splitter/split_ratio/fibre_in/fibre_out`. |
| **Physical** (untrustworthy — quarantine) | `THROUGH_SPLICE`, Stage-3 capacity-fill `DARK_STORAGE` | Suppress + gate. This is the `Math.min` output. |

---

## 3. Quarantine blast radius (verified by tracing consumers)

### Must change — the quarantine targets
- **`fibreAssign.js` Stage 3 (~L494–532)** — stop emitting `THROUGH_SPLICE` and the Stage-3
  capacity-fill `DARK_STORAGE`. Add `physicalPlanStatus: 'UNVERIFIED'` and
  `assignmentMode: 'PORTS_ONLY'` to the returned result. Per the spec §2, also drop Stage-1's
  blanket `DARK_STORAGE` emission while quarantined.
- **`splicePlan.js` (L179–205)** — the build-facing output; filters on `THROUGH_SPLICE` (201)
  and `DARK_STORAGE` (205). Disable/guard plan generation unless
  `physicalPlanStatus === 'VALIDATED'`.
- **UI entry points that trigger a splice plan** — gate/disable these:
  - `SplicePlanPanel.svelte` (`generateSplicePlan` / `downloadSplicePlan` / `downloadAllSplicePlans`)
  - `App.svelte` route-splice flow (`generateRouteSplicePlan` ~L1017, `downloadSplicePlan` ~L1019)
  - Show "Physical fibre allocation not calculated"; watermark any retained preview `DRAFT — UNVERIFIED`.
- **`projectStore.applyFibreAssignment` (~L591)** — keeps writing the port fields (good); just
  stop persisting the physical records, or store them explicitly typed as unverified. Must NOT
  overwrite a previously engineer-approved physical plan.

### Safe — no change needed (verified role-agnostic)
- **`designHealth.js` (L467–498)** — the assignment loop is a dangling-reference/connectivity
  check only (`joint_id`/`cable_id`/`bundle_id` must resolve). It does **not** key on
  `THROUGH_SPLICE`. Fewer records ⇒ fewer-or-equal flags, so quarantine **cannot introduce
  false health flags**. The `has_splitter`/stale-splitter logic reads asset props, not physical
  records.
- **`cascadeDelete.js`, `repairProject.js`, `projectSchema.js`** — treat `fibreAssignments` as a
  generic collection; role-agnostic; unaffected.
- **`AssetEditPanel.svelte`** — reads derived port/splitter fields only.
- **`bom.js`** — not a consumer of these records.

### Tests
- `splicePlan.test.js` fixtures are `SPLITTER_*` only (no `THROUGH_SPLICE`) — may not even break;
  re-check after gating.
- `fibreAssign.test.js` covers `stickyAllocate()` only — untouched by quarantine.
- New **golden fixtures** (spec §11) belong with the planner rewrite, not the quarantine.

**Net:** quarantine ≈ two files of real change (`fibreAssign.js` Stage 3, `splicePlan.js` gate)
plus disabling the two UI entry points. Everything else keeps working or is provably safe.

---

## 4. The planner rewrite (stage 2 — the real project)

Per the reference doc, treat it as a contained rewrite of the *physical planner*, not the app.
Target modules (all pure, testable):

| Module | Responsibility |
|---|---|
| `fibreNetwork.js` | Build a directed fibre graph rooted at the POP; orient edges downstream. |
| `fibreDemand.js` | Post-order demand pass — computes required fibres per edge; **emits no assignment records**. |
| `fibrePhysicalPlan.js` | Second pass — deterministic fibre-number allocation, through-splices, splitter inputs, dark storage. |
| `fibrePlanValidation.js` | Capacity/conservation/uniqueness/topology invariants before save. |
| `fibreAssign.js` | Orchestrates logical ports + the validated physical planner. |

**The biggest hidden cost is NOT the algorithm — it's the data model.** Spec §5: you cannot
infer splitter-output vs raw pass-through from cable size. Outgoing segments need explicit
`feed_mode` (`PASS_THROUGH` | `SPLITTER_OUTPUT`) + `splitter_id`/`splitter_port` metadata. That
touches `assetSchema.js`, `projectSchema.js`, and the drawing UI, **plus a migration/default for
existing projects (e.g. SCOT-PH1) that don't carry it.** Budget for this explicitly.

**Two decisions the field/engineering team owe before or during the rewrite:**
1. **Fibre-numbering profile (spec §9):** compact-outbound vs colour-preserving. Pick explicitly;
   don't let traversal order decide it.
2. **Reserve-fibre policy:** reserves are added only by an explicit engineering profile, never by
   capacity-fill.

**Mandatory behaviours:** capacity is a *validation that throws* (`CapacityError`), never a
silent `Math.min` clamp; frozen/installed physical fibres must not be renumbered when proposed
work is added; allocation must be deterministic (identical on repeat runs).

---

## 5. What to supply to the new chat

1. **This handoff** (`HANDOFF-demand-driven-through-splicing.md`).
2. **The reference spec PDF:** `Conductor_Demand_Driven_Through_Splicing_Remediation.pdf` — it has
   the demand rules, worked examples (A/B/C), invariants (§10) and the golden fixtures (§11) that
   the rewrite is tested against. This is the source of truth for correct behaviour.
3. **The full project zip** (attached alongside this handoff) — so the agent can read
   `fibreAssign.js`, `splicePlan.js`, `designHealth.js`, `projectStore.js`, the panels, and the
   existing tests directly. Already current: includes the mapTools decomposition and the
   versioning fix (`0.1.0-beta.1`).
4. **Also point the agent at:** `docs/TODO.md` item **"3. Demand-driven through-splicing"** (the
   original decision record and the SCOT-PH1 worked example: 96F feeder, 1:4, correct answer =
   1 tap + 95 dark, 0 through when nothing exists past the poles).

**Suggested opening instruction for the new chat:** *"Implement only the quarantine (Section 3 of
the handoff) first — no planner code yet. Then stop so I can review before the rewrite."*

---

## 6. Definition of done — quarantine only
- Splitter-port allocation still works and is still shown.
- `THROUGH_SPLICE` / Stage-3 dark records are no longer presented as authoritative.
- Splice-plan export is disabled unless `physicalPlanStatus === 'VALIDATED'`.
- A previously engineer-approved physical plan is never overwritten.
- `npm test` still green (adjust `splicePlan.test.js` only if gating changes its fixtures).
- `npm run dev`: placing/assigning still works; splice-plan buttons clearly show the unverified state.
