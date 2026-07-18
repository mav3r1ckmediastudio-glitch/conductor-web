# Conductor Web — Code Review Brief

> Review of `master` @ `ecf7cee` against baseline `7e074ed` (CAD export v0.4, 14 Jul 2026).
> Reviewed 17 Jul 2026. Written to drop into `docs/`.
> Convention follows `docs/TODO.md` — enough context to pick up cold.

**Baseline verified before review:** `npx vitest run` → **337 passing / 24 files**. `npx vite build` → **347 modules, clean, 4.59s**. Code-splitting intact (`PoleLayers` lazy, 134 kB gz; maplibre 273 kB gz; proj4 43 kB gz). Initial payload ≈ 528 kB gz.

---

## Summary

Nine issues. **None are live defects.** Every correctness finding is *inert* — the system is fail-closed where it matters, and two hypotheses I tried to prove were beaten by the code's own defence-in-depth (see "Rejected findings").

The single theme worth acting on: **dead code that lies.** Four separate places contain logic that looks load-bearing, isn't, and would mislead the next reader into an unsafe assumption. Items 1 and 2 are the ones that become real bugs on a plausible near-term change.

Priority order: **1, 2, 3** (one contained session) → 4–6 (hygiene) → 7–9 (notes).

---

## 1. `network.ok` is dead and carries a fail-open expression — P1

**Where:** `frontend/src/fibreNetwork.js:165`

```js
ok: errors.filter(x => x.code !== 'SEG_NO_ID').length === 0 || errors.length === 0,
```

**What's wrong:** two separate defects in one line.

- Clause 2 is **subsumed** by clause 1 — if `errors.length === 0`, the filter is also 0. It can never change the result. Its presence suggests the author wasn't sure the first clause was right.
- Clause 1 **exempts `SEG_NO_ID`** from failing the network. A segment with no id is *skipped entirely* by `pushSeg` (it `return`s) — it vanishes from the graph, gets no fibre records, and appears in no splice plan. Under this expression, a network that silently dropped a real cable still reports `ok: true`.

**Why it's inert:** `fibrePlanner.js` never reads `network.ok`. It aggregates independently:

```js
const errors = [...network.errors, ...demand.errors, ...alloc.errors, ...validation.errors];
const ok = errors.length === 0;
```

Confirmed by grep: the only `.ok` write in the pipeline is `fibreAssign.js:421` (`physical.ok = false`), unrelated. `network.ok` has **zero readers**.

**Why it still matters:** it is a loaded trap in the most fail-closed module in the repo. The first person to write `if (network.ok)` — reasonably, because it's right there in the return object — gets a fail-open on silently dropped segments.

**Fix:** delete the `ok` key from the `buildFibreNetwork` return. Nothing reads it, and `fibrePlanner` is the correct owner of that judgement. If it must stay, it is `errors.length === 0` with no exemption.

---

## 2. `store.allocationProfile` does not exist — P1 (latent)

**Where:** `frontend/src/fibrePlanInputs.js:37`

```js
parts.push('PROFILE\x1e' + String(store.allocationProfile || 'COLOUR_PRESERVING'));
```

**What's wrong:** `allocationProfile` appears **exactly once in the entire codebase** — on this line. Nothing writes it. It is not a `projectStore` getter. The term always evaluates to the literal `'COLOUR_PRESERVING'` and contributes nothing to the fingerprint.

The profile actually travels as a **call-time option**: `fibreAssign.js:415` (`profile: opts.profile`) → `fibrePlanner.js:17` (`opts.profile || PROFILE_COLOUR_PRESERVING`).

**Why it's inert today:** profile can only enter at compute time, so changing it forces a recompute, which stores a fresh hash. The staleness scenario the gate exists to catch cannot currently arise for this field.

**Why it matters:** the module header explicitly claims the fingerprint covers "topology, capacities, ratios, feed modes, **allocation profile**". It does not. The day profile becomes a persisted project setting — which that comment implies is the intent — a plan validated under one profile stays exportable under another. That is precisely the P0-1 class this module was built to close.

**Fix:** either (a) delete the term and correct the header comment, or (b) make `allocationProfile` a real store field and wire `opts.profile` to default from it. (b) is the better end state; (a) is honest until then.

---

## 3. `__rawFeed` is dead, and forces an O(E×N) re-lookup — P2

**Where:** `frontend/src/fibreNetwork.js:160` and `resolveExplicitFeed` (~line 170)

```js
const explicit = S(e.__rawFeed) || resolveExplicitFeed(store, e);
```

**What's wrong:** `__rawFeed` is written **nowhere**. The `edge` object literal at line ~146 doesn't include it. `S(undefined)` → `''` → falsy → **every edge, every time** falls through to `resolveExplicitFeed`.

`resolveExplicitFeed` then does a linear `.find()` across `store.cables` / `store.spans` / `store.cbtTails` to re-locate the props object that `rawSegs` **already carries** as `s.props` — and which is already reachable at that point. That's O(E×N) to retrieve data that was in hand.

**Compounding — duplicated tail-id logic.** The tail id fallback is now expressed twice, differently:

`pushSeg` call site (~line 108):
```js
S(t.properties.tail_id) || S(t.properties.cbttail_id) || (t.properties.from_cbt ? `TAIL-${S(t.properties.from_cbt)}` : null)
```
`resolveExplicitFeed`:
```js
S(t.properties.tail_id) || S(t.properties.cbttail_id) || `TAIL-${S(t.properties.from_cbt)}`
```

The second lacks the null guard. **No live divergence** (an empty `from_cbt` yields `null` in the first → `SEG_NO_ID` → skipped → no edge exists for the second to match). But it is two copies of an id-derivation rule that must agree forever, and one already drifted.

**Fix:** read `s.props.feed_mode` directly at edge construction and delete `resolveExplicitFeed` and `__rawFeed`. This kills the dead branch, the O(E×N), and the duplication in one move.

---

## 4. Dead branch in the CBT-tail capacity line — P3

**Where:** `frontend/src/fibreNetwork.js:107`

```js
const cap = Number.isFinite(intCap(t.props?.fibre_count)) ? intCap(t.props?.fibre_count)
          : (Number.isFinite(intCap(t.properties?.fibre_count)) ? intCap(t.properties.fibre_count) : 1);
```

`t.props` does not exist on any store object — the codebase uses `t.properties` throughout (the same line proves it by falling back to exactly that). The first branch can never be taken.

**Fix:** collapse to the `t.properties` read with the `|| 1` default. Reduces a triple-nested ternary to one expression.

---

## 5. `-SP` is a magic suffix duplicated across 8 files — P3

**Where:** `fibreNetwork.js:189`, `fibreAssign.js:311,385,481`, `fibrePhysicalPlan.js:120`, `fibrePlanValidation.js:132`, `AssetEditPanel.svelte:270-271`, `CableForm.svelte:156`, `CBTTailForm.svelte:31`, `BranchClassificationPanel.svelte:63`

The splitter-id convention `${nodeId}-SP` is re-derived by hand in 11 places, including one user-facing free-text input placeholder (`CableForm.svelte:156`).

**Not a correctness hole.** `fibrePlanValidation.js:132` independently re-derives `expectId = \`${e.from}-SP\`` as a mandatory invariant, so a typo'd `splitter_id` **fails closed** rather than silently mis-planning. And `CableForm.svelte:52` only writes `splitter_id` when `feed_mode === 'SPLITTER_OUTPUT'`, so `defaultFeedMode`'s `-SP` check (`fibreNetwork.js:189`) is only consulted for segments carrying a `splitter_id` with **no** explicit `feed_mode` — i.e. legacy or imported data.

**Fix:** one exported `splitterIdFor(nodeId)` helper + `SPLITTER_ID_SUFFIX` constant. Mechanical, low risk.

---

## 6. `SEG_NO_ID` has no test coverage — P2

`grep` across `src/__tests__/` finds assertions for `MULTI_FEEDER`, `AMBIGUOUS_ORIENT`, and `DUP_SEGMENT_ID`. **`SEG_NO_ID` has none** — and it is the only error code exempted from `network.ok` (item 1). The untested code and the anomalous code are the same code. That is not a coincidence.

**Fix:** add two cases alongside item 1's fix — an id-less segment *with* downstream demand (must be `INVALID` via `DISCONNECTED_DEMAND`/`UNFED_TERMINAL`) and one *without* (currently also `INVALID`; lock that in so it can't regress to a silent drop).

---

## 7. `BETA-5-CHANGES.md` test count is already stale — P3

Doc claims **331 passing across 23 files**. Actual on `ecf7cee`: **337 across 24**.

Trivial in isolation, but this is the exact failure mode `CAD_VERSION` was introduced to prevent — debugging against a stale number. A release doc that's wrong on its own verification line is worse than one that omits it.

**Fix:** correct it, or drop the count and cite the CI run.

---

## 8. `COMPACT_OUTBOUND` is test-only surface — P3

`PROFILE_COMPACT_OUTBOUND` is referenced from `fibrePhysicalPlan.js` (its definition + two use sites) and `fibrePlanner.test.js`. **No UI path reaches it.** Fine if it's a deliberate spec-§9 placeholder; dead feature surface if not. Related to item 2 — wiring profile into the store would make both real at once.

---

## 9. Edge auth — two notes, no defects — P3

`frontend/netlify/edge-functions/basic-auth.js` reviewed in full. **It is sound**: fail-closed 503 on missing/`REPLACE_ME` config; no early return in the credential loop (`equalDigest(...) || matched` always evaluates the left operand, so timing doesn't leak which account matched); constant-time digest comparison; correct UTF-8 handling (`atob` → `Uint8Array` → fatal `TextDecoder`); `private, no-store` forced onto authenticated responses so nothing lands in a shared cache; `config = { path: '/*' }`.

Two things to record rather than fix:

- **Credential charset is silently constrained.** `parseCredentialList`'s regex `^[^:\s]+:[^:\s]{12,}$` bans `:` and whitespace in passwords and enforces a 12-char minimum. A colon in a password fails the *whole list* → **the entire site returns 503**, and the only signal is `console.error` in the function log. Fail-closed and therefore correct, but a real footgun. Belongs in `SECURITY_AND_KEYS.md`.
- **No brute-force throttle.** Acceptable for a private beta behind a 12+ char secret. Worth a conscious note rather than an accidental omission.

---

## Rejected findings

Recorded so they aren't re-raised.

- **"`SEG_NO_ID` is an exploitable fail-open."** Tested, **false**. A repro with an id-less cable feeding a demanding terminal (`JNT-003`, 1:8) returns `status: 'INVALID'` with `DISCONNECTED_DEMAND` + `UNFED_TERMINAL`. A repro with an id-less segment and *no* downstream demand also returns `INVALID`, because `fibrePlanner` aggregates raw `errors.length` and never consults `network.ok`. The defence-in-depth holds. Item 1 survives only as a trap for future callers — a much weaker claim.
- **"The plan-input fingerprint has coverage gaps."** Checked field-by-field, **false**. Every field `fibreNetwork.js` reads (`cable_id`, `cbt_id`, `cbttail_id`, `chamber_id`, `feed_mode`, `fibre_count`, `from_cbt`, `from_joint`, `from_node`, `has_splitter`, `joint_id`, `parent_pole_id`, `pop_id`, `span_id`, `split_ratio`, `splitter_port`, `tail_id`, `to_joint`, `to_node`) is in `canonicalPlanInputs`. `joint_type` and `splitter_id` are over-covered — the safe direction. P0-1 holds. Only the `allocationProfile` term (item 2) is inert.
- **"Deleting `validateRoutes.js` lost tested logic."** **False** — it was dead. Nothing imported `validateAllRoutes`/`computeSummary`; `ValidateRoutesPanel.svelte` calls `traceFibre` directly. Same for `plantGenerator.js` and `networkSpotlight.js` (dev-only), and the Vite scaffold leftovers (`button.svelte`, `lib/Counter.svelte`, `assets/*`). Removing `src.zip` (203 kB checked-in build artefact) is a straight win.

---

## What's good (do not regress)

Stated plainly because the list above is all criticism and the balance is misleading.

- **The four-pass planner is the best-engineered subsystem in the repo.** `buildFibreNetwork → computeDemand → allocatePhysicalFibres → validatePhysicalPlan`, each pure, each emitting no authoritative records until validated. `CapacityError` yields **no partial plan**. `validatePhysicalPlan` independently re-derives its invariants rather than trusting the allocator's own bookkeeping — that's why items 1 and 6 are inert instead of shipping incidents.
- **`DUP_SEGMENT_ID`** rejects cross-collection id collisions *before* graph construction, closing a silent-edge-merge hole.
- **The decomposition cost nothing.** `App.svelte` −1,048 and `mapTools.js` −3,344 into a facade + 8 cohesive modules, with the build still at 347 clean modules and lazy `PoleLayers` intact.
- **The splitter-output port fix** carrying one canonical port through all three representations, with fail-closed rejection of zero/multiple downstream splitters and any conflict against a frozen `INSTALLED`/`LIVE` child, is the right shape.

---

## Suggested sequencing

**Session A (contained, ~1 sitting):** items 1, 3, 4 — all in `fibreNetwork.js`, all deletions. Then item 6's tests to lock the behaviour. Net: file gets shorter, faster, and stops lying.

**Session B:** item 2 — decide (a) or (b). If (b), item 8 resolves with it.

**Session C (mechanical):** item 5, then items 7 and 9's doc lines.

Nothing here blocks the beta.
