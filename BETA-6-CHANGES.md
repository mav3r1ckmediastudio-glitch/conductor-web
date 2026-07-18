# Conductor Web v0.1.0-beta.6

**Theme: code review remediation. No user-facing feature changes.**

This release closes the findings from the 17 Jul 2026 review of `master` @
`ecf7cee` against baseline `7e074ed` (see `docs/REVIEW-BRIEF-2026-07-17.md`).

Every correctness finding was **inert** — none were live defects, and no shipped
behaviour was wrong. The work here removes code that *looked* load-bearing,
wasn't, and would have misled the next reader into an unsafe assumption. The
value is in what can no longer go wrong, not in anything that now works better.

---

## ⚠️ Upgrade note — validated plans require a re-run

The plan-input fingerprint format moved **`p2-` → `p3-`** (a dead term was
removed from the canonical string — see item 2). Hash comparison is string
equality, so **any project saved with a `p2-` hash will mismatch on load and
close its splice-export gate until Fibre Assign is re-run.**

This is fail-closed and the correct direction: the gate refuses to certify a plan
it cannot verify. Re-running Fibre Assign restores the gate. No project data is
lost or altered — only the plan's *validated* claim is withdrawn pending recompute.

---

## Fixed

### Dead code removed from `fibreNetwork.js` (items 1, 3, 4)

- **`network.ok` deleted.** It was computed as
  `errors.filter(x => x.code !== 'SEG_NO_ID').length === 0 || errors.length === 0`
  — a redundant second clause, and a first clause that **exempted `SEG_NO_ID`**,
  so a graph that had silently *dropped* a real segment still reported `ok: true`.
  Nothing read it (`fibrePlanner.js` aggregates errors across all four passes and
  owns that judgement alone), so it was a trap rather than a defect. A regression
  test now asserts `buildFibreNetwork` returns no `ok` at all.
- **`__rawFeed` and `resolveExplicitFeed()` deleted.** `__rawFeed` was written
  nowhere, so every edge fell through to a linear `.find()` back through
  `store.cables`/`spans`/`cbtTails` to re-locate the props object already carried
  on `s.props` — **O(E×N) for data in hand**. `feed_mode` is now read at edge
  construction (`edge.rawFeed`). This also deletes a second, drifted copy of the
  CBT tail-id rule; `tailSegmentId()` is now the only derivation.
- **Dead `t.props?.fibre_count` branch collapsed.** `t.props` exists on no store
  object (it is `t.properties` throughout — the same line proved it by falling
  back to exactly that). A triple-nested ternary is now one expression.

### Allocation profile no longer falsely fingerprinted (item 2)

`fibrePlanInputs.js` hashed `store.allocationProfile` — a field that exists
**nowhere else in the codebase**. Nothing wrote it; it is not a `projectStore`
getter. The term always evaluated to the literal `'COLOUR_PRESERVING'` and
contributed nothing, while the module header claimed the fingerprint covered it.

Dead term removed, claim withdrawn, and the reasoning documented in place: profile
is currently a **call-time option** (`fibreAssign.js` → `opts.profile` →
`fibrePlanner.js`), not project state, which is why omitting it is safe *today* —
a non-persisted value cannot go stale.

> **OPEN — PW's call.** Whether to promote `allocationProfile` to a real store
> field is a design decision and was deliberately **not** made during this pass.
> If it ever becomes persisted project state it **must** be added back to
> `canonicalPlanInputs()` and the hash prefix bumped, or a plan validated under
> `COLOUR_PRESERVING` stays exportable after a switch to `COMPACT_OUTBOUND` —
> exactly the P0-1 class the module exists to close. A `>>>`-flagged block in
> `fibrePlanInputs.js` says so at the point of change. Resolving this would also
> resolve item 8 (`COMPACT_OUTBOUND` is currently reachable only from tests).

### `-SP` splitter-id convention centralised (item 5)

New `frontend/src/splitterId.js` — `SPLITTER_ID_SUFFIX`, `splitterIdFor(nodeId)`,
`isSplitterId(id)`. The suffix was previously hand-derived in **11 places across
8 files**, including a user-facing input placeholder (`CableForm.svelte`) and a
mandatory plan invariant (`fibrePlanValidation.js`). All now route through one
helper.

Not a correctness fix — `fibrePlanValidation.js` independently re-derives the
expected id, so a typo'd `splitter_id` already failed closed. That independence is
**preserved**: the invariant uses the helper for the convention, but the
comparison remains its own.

**Minor behaviour change:** `splitterIdFor()` returns `null` for a missing node id
rather than fabricating the string `'undefined-SP'`, which the old inline
`jointId + '-SP'` produced and then compared against real ids (never matching,
silently). Covered by tests.

### 3D poles floated off (or sank into) the terrain away from Perthshire

`PoleLayers.js` computes `_mpu` (metres -> mercator) once from `SCENE_ORIGIN`,
a hardcoded `{lng: -3.77, lat: 56.71}`. MapLibre's metre->mercator scale is
**latitude-dependent** (`1 / (earthCircumference * cos(lat))`), and the terrain
surface converts each point's elevation using **that point's own** latitude. So
feeding `queryTerrainElevation`'s TRUE metres into a scene scaled for 56.71N put
every pole off the ground by `groundElev * (cos(poleLat)/cos(56.71) - 1)`:

| site | float |
|---|---|
| Dunning, 56.31N, ~60m ASL | **+0.95 m** (the reported symptom) |
| Chester / Tarvin, ~55m ASL | +7.56 m |
| Snowdonia, ~600m ASL | +85.20 m |
| Shetland, ~40m ASL | **-5.59 m** (sank, depth-occluded) |
| At `SCENE_ORIGIN` itself | 0.00 m |

`_elevAt()` now converts per point into scene metres, making the pole's mercator
Z algebraically identical to the terrain's at **any** latitude, independent of
where `SCENE_ORIGIN` sits: `Zpole = e*(mpuHere/_mpu)*_mpu = e*mpuHere = Zterrain`.

Ruled out, recorded so they aren't re-checked: **terrain exaggeration is not
involved** (`Terrain.getElevation()` already returns `getDEMElevation()*exaggeration`,
so the 1.5x is in the query and cancels), and the pole-centring maths was always
right (`groundElev + POLE_HEIGHT_M/2` on a 6m cylinder puts the base exactly on
`groundElev`). East/north were never affected — they round-trip through `_mpu`
and cancel exactly; only Y mixed in an external true-metre quantity.

**This is NOT the coarse-DEM refresh bug** documented at the top of that file.
That one is about *when* elevation is read; this is about what a metre *means*.
Same symptom, unrelated cause, both fixes needed. The stale `SCENE_ORIGIN`
comment ("matches map center") is what hid it — the camera stopped opening on
that fixed centre, so the assumption silently expired. Comment corrected.

> **OPEN — PW's call.** Scene-metre *constants* (`POLE_HEIGHT_M`, radii, hologram
> sizes) still render at `cos(56.71)/cos(designLat)` of nominal — a 6m pole draws
> as ~5.4m in Shetland, ~7.0m at the Lizard. **Cosmetic only:** grounding is now
> exact everywhere, horizontal positions were never affected, and stored design
> data is untouched (the 3D layer is pure visualisation). Fixing it properly means
> deriving the origin from the build-area centroid and recomputing the origin
> matrix on load — a design change to a module ported from an upstream MapLibre
> example, deliberately not made unilaterally.

## Tests

- **New `segmentIdIntegrity.test.js`** (item 6). `SEG_NO_ID` was the only
  `buildFibreNetwork` error code with no test, *and* the only one the old
  `network.ok` exempted — the untested code and the anomalous code were the same
  code. Now pinned: an id-less segment is skipped, and can never yield an
  authoritative plan, both when something downstream demands a fibre
  (`UNFED_TERMINAL` fires) and when nothing does (only `SEG_NO_ID` fires — the
  case the old `ok` would have passed).
- **New `splitterId.test.js`** — helper contract incl. the null guard.
- **`npm test`: 350 passing across 26 test files** (was 337 / 24).

## Docs

- `docs/REVIEW-BRIEF-2026-07-17.md` — full review brief, incl. a **Rejected
  findings** section recording two hypotheses that were tested and disproved, so
  they are not re-raised.
- `SECURITY_AND_KEYS.md` — beta access gate credential format constraints (item
  9). A colon or space in a password fails the whole list and takes the entire
  site to 503, signalled only in the function log. Also records the absence of a
  brute-force throttle as a conscious omission.
- `BETA-5-CHANGES.md` — corrected its test count (claimed 331/23, actual was
  337/24 at `ecf7cee`) (item 7).

## Reviewed, no change

- **Edge auth gate** (`netlify/edge-functions/basic-auth.js`) reviewed in full and
  found sound: fail-closed 503 on missing/`REPLACE_ME` config; no early return in
  the credential loop, so timing does not leak which account matched;
  constant-time digest comparison; correct UTF-8 handling; `private, no-store`
  forced onto authenticated responses. Documented, not changed.
- **Plan-input fingerprint coverage** verified field-by-field against everything
  `fibreNetwork.js` reads. Complete, with `joint_type`/`splitter_id` over-covered
  — the safe direction. P0-1 holds. Only the `allocationProfile` term was inert.

## Verification

- `npm test` → **350 passing / 26 files**, 0 failing.
- `npx vite build` → **348 modules transformed, clean**. Code-splitting intact
  (`PoleLayers` still lazy). Main bundle **181.59 kB gz** — marginally smaller
  than beta.5's 181.68 kB despite the added module.
- `npx playwright test` -> **12 passing / 12**, incl. the branch-classification
  lifecycle spec that drives VALIDATED -> export gate opens -> edit closes it,
  which is the exact path the p2->p3 hash change runs through.

---

## Before tagging

1. **Smoke the upgrade path.** Open an existing project saved under beta.5 and
   confirm the splice-export gate closes with a sensible message, then re-run
   Fibre Assign and confirm it reopens. This is the `p2-` → `p3-` consequence and
   is the only user-visible change in the release.
2. **Decide item 2** (`allocationProfile` → store field, or leave as call-time
   option). Not blocking; the flag in `fibrePlanInputs.js` holds the line either way.
