// designHealth.js — Conductor Web Design Health Check
// Port of conductor_v2/tools/design_health.py
//
// "Would this network work if it were built right now?"
// An AGGREGATOR: runs existing validators and re-weighs their findings under
// one specific lens — whether the network as drawn would physically function
// if built today. Deliberately stricter than validateRoutes alone:
//
//   ERROR   -> would NOT work if built          -> verdict NO-GO
//   WARNING -> would work, but you should know  -> verdict CAUTION
//   INFO    -> completeness / cost only         -> verdict GO (if no errors/warnings)
//
// Check 1  — Route validation (PARTIAL→ERROR, ROUTED-no-splitter→ERROR, UNSERVED→WARNING)
// Check 1b — Splitter cascade must be exactly two stages (operator-agnostic PON requirement)
// Check 1c — Strict Gigaloch cascade order: 1:8 nearest premises, 1:4 nearest cabinet
// Check 2  — Topology / FK integrity (spans, drops, tails, cables, bundles)
// Check 2b — Splitter capacity & declaration (overcapacity→ERROR, undeclared→WARNING, stale→WARNING)
// Check 2c — Broader FK integrity (cables from/to_node, bundles from_joint, drop from_cbt)
// Check 2d — Remaining FK checks (cable duct_id, joint chamber_id, bundle uprn, fibre assignments)
// Check 3  — Design completeness (INFO only)

import { traceFibre } from './fibreTrace.js';

export const VERDICT = { GO: 'GO', CAUTION: 'CAUTION', NOGO: 'NO-GO' };

function add(issues, tier, category, message, assetId = '', layer = '') {
  issues.push({ tier, category, message, assetId, layer });
}

// Extract the N from a "1:N" ratio string. Defaults to 8 (1:8) if unparseable.
function capOf(ratio) {
  const m = String(ratio || '').match(/:(\d+)/);
  return m ? parseInt(m[1], 10) : 8;
}

// Gigaloch's specific two-stage cascade convention (Check 1c). Unlike Check 1b
// (operator-agnostic — any two stages, any ratios), this is deliberately
// hardcoded to Gigaloch's build standard: 1:8 nearest the premises (terminal
// splitter), 1:4 nearest the cabinet (feeder splitter). Per memory: "Gigaloch
// 1:4x1:8 GPON cascade on Calix E7-2." A different operator running this tool
// would want this check disabled or reconfigured, not applied — it is NOT a
// PON invariant the way Check 1b's stage-count is.
const GIGALOCH_NEAR_PREMISE_RATIO = '1:8';
const GIGALOCH_NEAR_CABINET_RATIO = '1:4';

/**
 * Run the design readiness check against the current project store state.
 *
 * Returns:
 * {
 *   verdict:      'GO' | 'CAUTION' | 'NO-GO',
 *   headline:     string,
 *   errorCount:   number,
 *   warningCount: number,
 *   infoCount:    number,
 *   routed:       number,
 *   partial:      number,
 *   unserved:     number,
 *   total:        number,
 *   issues:       Array<{ tier, category, message, assetId, layer }>,
 *   ran:          { routes: bool, integrity: bool, structure: bool },
 * }
 */
export function runDesignHealth(store) {
  const issues = [];
  const ran = { routes: false, integrity: false, structure: false };
  let routed = 0, partial = 0, unserved = 0, total = 0;

  // ── 1. Route validation ────────────────────────────────────────────────────
  // Re-weight vs validateRoutes:
  //   PARTIAL          → ERROR   (premises would be dark fibre if built)
  //   ROUTED, no split → ERROR   (path reaches POP but has no passive splitter
  //                               — cannot be a PON customer, operator-agnostic)
  //   UNSERVED         → WARNING (incomplete design; built portion still works)
  try {
    const addressPoints = store.addressPoints || [];
    total = addressPoints.length;

    if (!store.cabinet) {
      add(issues, 'error', 'No cabinet',
        'No cabinet or POP placed — cannot verify routes.', '', '');
    } else if (total === 0) {
      add(issues, 'warning', 'No premises',
        'No address points imported — import a CSV to enable route checking.', '', '');
    } else {
      const PARTIAL_CAP  = 10;
      const BAD_CASCADE_CAP = 10;
      const BAD_ORDER_CAP = 10;
      let partialShown   = 0;
      let badCascadeCount = 0;
      let badCascadeShown = 0;
      let badOrderCount = 0;
      let badOrderShown = 0;

      for (const ap of addressPoints) {
        const r = traceFibre(store, ap.properties?.uprn);

        if (r.status === 'ROUTED') {
          routed++;

          // Check 1b — splitter cascade stage count (operator-agnostic PON
          // requirement). A viable premises connection requires EXACTLY TWO
          // passive splitter stages between the premise and the cabinet —
          // that's a structural PON invariant, not an operator-specific rule.
          // How each ISP achieves that 1:32 (Gigaloch: 1:4 feeder → four
          // 1:8 terminals; another operator might do 1:2 → 1:16, etc.) is
          // deliberately NOT checked here — ratios are validated separately
          // in Check 2b (capacity/declaration drift) using each splitter's
          // own split_ratio field, never a hardcoded value.
          const splitters = r.optical?.breakdown?.splitters;
          if (splitters && splitters.length !== 2) {
            badCascadeCount++;
            if (badCascadeShown < BAD_CASCADE_CAP) {
              const n = splitters.length;
              const detail = n === 0
                ? 'no passive splitter found'
                : n === 1
                  ? 'only one splitter stage found — a viable PON connection needs two'
                  : `${n} splitter stages found — a viable PON connection needs exactly two`;
              add(issues, 'error', 'Wrong splitter cascade',
                `Routed but ${detail}: ${ap.properties?.address || ap.properties?.uprn || '?'}`,
                String(ap.properties?.uprn || ''), 'premises');
              badCascadeShown++;
            }
          } else if (splitters && splitters.length === 2) {
            // Check 1c — strict Gigaloch cascade order. Only meaningful once
            // 1b has already confirmed exactly two stages exist; this is a
            // stricter, Gigaloch-specific rule layered on top, not a
            // replacement for 1b's operator-agnostic count check. optical.js's
            // splitters array is built by walking nodePath, which fibreTrace.js
            // constructs as entry.node (premise side) … popId (cabinet),
            // reversed into that order — so splitters[0] is nearest the
            // premise and splitters[1] is nearest the cabinet, not the reverse.
            const [nearPremise, nearCabinet] = splitters;
            const wrongOrder =
              nearPremise !== GIGALOCH_NEAR_PREMISE_RATIO ||
              nearCabinet !== GIGALOCH_NEAR_CABINET_RATIO;
            if (wrongOrder) {
              badOrderCount++;
              if (badOrderShown < BAD_ORDER_CAP) {
                const swapped =
                  nearPremise === GIGALOCH_NEAR_CABINET_RATIO &&
                  nearCabinet === GIGALOCH_NEAR_PREMISE_RATIO;
                const detail = swapped
                  ? `cascade order is reversed (${nearPremise} nearest premises, ${nearCabinet} nearest cabinet — should be ${GIGALOCH_NEAR_PREMISE_RATIO} then ${GIGALOCH_NEAR_CABINET_RATIO})`
                  : `wrong split ratios (${nearPremise} nearest premises, ${nearCabinet} nearest cabinet — Gigaloch standard is ${GIGALOCH_NEAR_PREMISE_RATIO} nearest premises, ${GIGALOCH_NEAR_CABINET_RATIO} nearest cabinet)`;
                add(issues, 'error', 'Wrong splitter cascade order',
                  `Routed but ${detail}: ${ap.properties?.address || ap.properties?.uprn || '?'}`,
                  String(ap.properties?.uprn || ''), 'premises');
                badOrderShown++;
              }
            }
          }

        } else if (r.status === 'PARTIAL') {
          partial++;
          if (partialShown < PARTIAL_CAP) {
            add(issues, 'error', 'Incomplete route',
              `Partial route — premises would be dark if built: ${ap.properties?.address || ap.properties?.uprn || '?'}`,
              String(ap.properties?.uprn || ''), 'premises');
            partialShown++;
          }
        } else {
          unserved++;
        }
      }

      if (partial > PARTIAL_CAP) {
        add(issues, 'error', 'Incomplete route',
          `…and ${partial - PARTIAL_CAP} more partial route(s) — showing first ${PARTIAL_CAP} only.`,
          '', 'premises');
      }
      if (badCascadeCount > BAD_CASCADE_CAP) {
        add(issues, 'error', 'Wrong splitter cascade',
          `…and ${badCascadeCount - BAD_CASCADE_CAP} more route(s) with a wrong splitter cascade — showing first ${BAD_CASCADE_CAP} only.`,
          '', 'premises');
      }
      if (badOrderCount > BAD_ORDER_CAP) {
        add(issues, 'error', 'Wrong splitter cascade order',
          `…and ${badOrderCount - BAD_ORDER_CAP} more route(s) with the wrong cascade order — showing first ${BAD_ORDER_CAP} only.`,
          '', 'premises');
      }
      if (unserved > 0) {
        add(issues, 'warning', 'Incomplete design',
          `${unserved} of ${total} premise(s) have no route yet — the built portion works, but the design is not complete.`,
          '', 'premises');
      }
    }
    ran.routes = true;
  } catch (e) {
    add(issues, 'error', 'Check failed',
      `Route validation could not run: ${e.message}`, '', '');
  }

  // ── 2. Topology / FK integrity ─────────────────────────────────────────────
  // 2a  — Cross-asset node references must resolve to real features
  // 2b  — Splitter capacity and declaration
  // 2c  — Broader FK checks: cables, bundles, aerial drops
  try {
    // Build ID lookup sets (used by 2a, 2b, 2c, 2d)
    const chamberIds = new Set(
      (store.chambers || []).map(f => String(f.properties?.chamber_id || '')).filter(Boolean));
    const jointIds = new Set(
      (store.joints || []).map(f => String(f.properties?.joint_id || '')).filter(Boolean));
    const poleIds = new Set(
      (store.poles || []).map(f => String(f.properties?.pole_id || '')).filter(Boolean));
    const cbtIds = new Set(
      (store.cbts || []).map(f => String(f.properties?.cbt_id || '')).filter(Boolean));
    const ductIds = new Set(
      (store.ducts || []).map(f => String(f.properties?.duct_id || '')).filter(Boolean));
    const bundleIds = new Set(
      (store.bundles || []).map(f => String(f.properties?.bundle_id || '')).filter(Boolean));
    const cableIds = new Set(
      (store.cables || []).map(f => String(f.properties?.cable_id || '')).filter(Boolean));
    const aerialDropIds = new Set(
      (store.aerialDrops || []).map(f => String(f.properties?.adrop_id || f.properties?.drop_id || '')).filter(Boolean));
    const addressUprns = new Set(
      (store.addressPoints || []).map(f => String(f.properties?.uprn || '')).filter(Boolean));

    // All node IDs — includes both cabinet_id and pop_id since different tools
    // may use either field as the cable endpoint reference.
    const allNodeIds = new Set([...chamberIds, ...jointIds, ...poleIds, ...cbtIds]);
    if (store.cabinet?.properties?.cabinet_id) allNodeIds.add(String(store.cabinet.properties.cabinet_id));
    if (store.cabinet?.properties?.pop_id)     allNodeIds.add(String(store.cabinet.properties.pop_id));

    // ── 2a. Existing aerial checks ───────────────────────────────────────────

    // Aerial spans: both endpoints must resolve to a known node
    for (const span of (store.spans || [])) {
      const p = span.properties || {};
      const sid = p.span_id || '?';
      if (p.from_node && !allNodeIds.has(String(p.from_node))) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial span ${sid}: from_node "${p.from_node}" not found — topology broken.`,
          sid, 'spans');
      }
      if (p.to_node && !allNodeIds.has(String(p.to_node))) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial span ${sid}: to_node "${p.to_node}" not found — topology broken.`,
          sid, 'spans');
      }
    }

    // Aerial drops: from_node must resolve to a CBT or pole (legacy field)
    const aerialNodeIds = new Set([...poleIds, ...cbtIds]);
    for (const drop of (store.aerialDrops || [])) {
      const p = drop.properties || {};
      const did = p.adrop_id || p.drop_id || '?';
      if (p.from_node && !aerialNodeIds.has(String(p.from_node))) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial drop ${did}: from_node "${p.from_node}" not found as a CBT or pole.`,
          did, 'aerialDrops');
      }
    }

    // CBT tails: from_cbt must resolve + 350m hard-stop
    for (const tail of (store.cbtTails || [])) {
      const p = tail.properties || {};
      const tid = p.tail_id || '?';
      if (p.cbt_id && !cbtIds.has(String(p.cbt_id))) {
        add(issues, 'error', 'Broken connectivity',
          `CBT tail ${tid}: references CBT "${p.cbt_id}" which does not exist.`,
          tid, 'cbtTails');
      }
      const len = parseFloat(p.length_m || 0);
      if (len > 350) {
        add(issues, 'warning', 'CBT tail too long',
          `CBT tail ${tid} is ${Math.round(len)}m — exceeds the 350m hard stop.`,
          tid, 'cbtTails');
      }
    }

    // ── 2b. Splitter capacity & declaration ──────────────────────────────────
    // Port of conductor_v2/tools/splitter_topology.py (drift detection).
    //
    // CBTs: always splitters. Count aerial drops per CBT; flag if over cap.
    for (const cbt of (store.cbts || [])) {
      const p = cbt.properties || {};
      const id = String(p.cbt_id || '');
      if (!id) continue;
      const ratio = p.split_ratio || '1:8';
      const cap   = capOf(ratio);
      const count = (store.aerialDrops || [])
        .filter(d => String(d.properties?.from_cbt || '') === id).length;
      if (count > cap) {
        add(issues, 'error', 'Splitter overcapacity',
          `CBT ${id} has ${count} aerial drop(s) but split ratio is ${ratio} (${cap} ports) — ${count - cap} over capacity.`,
          id, 'cbts');
      }
    }

    // Joints with has_splitter: count bundles per joint; flag if over cap.
    // Joints without has_splitter but with bundles attached: undeclared splitter
    // — optical budget will miss the splitter insertion loss for these premises.
    for (const joint of (store.joints || [])) {
      const p = joint.properties || {};
      const id = String(p.joint_id || '');
      if (!id) continue;
      const hasSplitter = p.has_splitter === true || p.has_splitter === 1 || p.has_splitter === 'true';
      const bundleCount = (store.bundles || [])
        .filter(b => String(b.properties?.from_joint || '') === id).length;

      if (hasSplitter) {
        const ratio = p.split_ratio || '1:8';
        const cap   = capOf(ratio);
        if (bundleCount > cap) {
          add(issues, 'error', 'Splitter overcapacity',
            `Joint ${id} has ${bundleCount} bundle(s) but split ratio is ${ratio} (${cap} ports) — ${bundleCount - cap} over capacity.`,
            id, 'joints');
        } else if (bundleCount === 0) {
          // Stale declaration: has_splitter is set but nothing downstream needs
          // it. IMPORTANT: a splitter's consumers aren't always bundles — a
          // feeder splitter's consumers are OTHER downstream splitter joints
          // or CBTs (that's the whole point of a cascade), so bundleCount===0
          // is a feeder's NORMAL state, not staleness. Only flag when this
          // joint isn't feeding anything at all: no bundles, and no cable,
          // span, or CBT tail connects it onward to another declared splitter
          // joint or CBT.
          const isDownstreamSplitter = (other) => {
            if (!other || other === id) return false;
            if (cbtIds.has(other)) return true;   // CBTs are always splitters
            const otherJoint = (store.joints || []).find(j => String(j.properties?.joint_id) === other);
            const ohs = otherJoint?.properties?.has_splitter;
            return ohs === true || ohs === 1 || ohs === 'true';
          };
          const feedsViaCable = (store.cables || []).some(c => {
            const cp = c.properties || {};
            const other = String(cp.from_node || '') === id ? String(cp.to_node || '')
                        : String(cp.to_node || '') === id ? String(cp.from_node || '')
                        : null;
            return isDownstreamSplitter(other);
          });
          // Aerial spans are a separate collection from cables (2a above) —
          // a splitter feeding an onward aerial leg to another splitter/CBT
          // was previously invisible here.
          const feedsViaSpan = (store.spans || []).some(s => {
            const sp = s.properties || {};
            const other = String(sp.from_node || '') === id ? String(sp.to_node || '')
                        : String(sp.to_node || '') === id ? String(sp.from_node || '')
                        : null;
            return isDownstreamSplitter(other);
          });
          // CBT tails run from_cbt -> to_joint (the physical lay direction),
          // but the *feed* relationship is the reverse: this joint feeds the
          // CBT at the other end of the tail. A splitter feeding only via
          // tails (JNT-001-style: 1:4 feeding two 1:8 CBTs) was previously
          // invisible here — cbtTails was never inspected.
          const feedsViaTail = (store.cbtTails || []).some(t => {
            const tp = t.properties || {};
            if (String(tp.to_joint || '') !== id) return false;
            return cbtIds.has(String(tp.from_cbt || ''));
          });
          const feedsAnotherSplitter = feedsViaCable || feedsViaSpan || feedsViaTail;
          if (!feedsAnotherSplitter) {
            // Not dangerous the way oversubscription or an undeclared splitter
            // are (it doesn't understate an optical budget or imply false
            // capacity), but it's real drift worth a note — this joint is
            // carrying splitter insertion loss in any route through it for
            // no reason.
            add(issues, 'warning', 'Stale splitter declaration',
              `Joint ${id} has has_splitter set (${ratio}) but feeds no premises or downstream splitters — declaration may be stale.`,
              id, 'joints');
          }
        }
      } else if (bundleCount > 0) {
        // Joint has bundles but no splitter declared.
        // Optical budget calculated by traceFibre will not include splitter
        // insertion loss for these premises — loss figures will be understated.
        add(issues, 'warning', 'Undeclared splitter',
          `Joint ${id} has ${bundleCount} bundle(s) attached but has_splitter is not set — optical budget will be understated for these premises.`,
          id, 'joints');
      }
    }

    // ── 2c. Broader FK integrity ─────────────────────────────────────────────
    // Catches snapping failures and manual edits that leave dangling references.

    // Cables: both endpoints must resolve to a known node (chamber/joint/pole/POP)
    for (const cable of (store.cables || [])) {
      const p = cable.properties || {};
      const cid = p.cable_id || '?';
      if (p.from_node && !allNodeIds.has(String(p.from_node))) {
        add(issues, 'error', 'Broken connectivity',
          `Cable ${cid}: from_node "${p.from_node}" not found — cable is unconnected at its source end.`,
          cid, 'cables');
      }
      if (p.to_node && !allNodeIds.has(String(p.to_node))) {
        add(issues, 'error', 'Broken connectivity',
          `Cable ${cid}: to_node "${p.to_node}" not found — cable is unconnected at its destination end.`,
          cid, 'cables');
      }
    }

    // Bundles: from_joint must resolve to a known joint
    for (const bundle of (store.bundles || [])) {
      const p = bundle.properties || {};
      const bid = p.bundle_id || '?';
      if (p.from_joint && !jointIds.has(String(p.from_joint))) {
        add(issues, 'error', 'Broken connectivity',
          `Bundle ${bid}: from_joint "${p.from_joint}" not found — bundle has no network entry point.`,
          bid, 'bundles');
      }
    }

    // Aerial drops: from_cbt must resolve to a known CBT
    // (Complements the existing from_node check which covers the legacy field.)
    for (const drop of (store.aerialDrops || [])) {
      const p = drop.properties || {};
      const did = p.adrop_id || p.drop_id || '?';
      if (p.from_cbt && !cbtIds.has(String(p.from_cbt))) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial drop ${did}: from_cbt "${p.from_cbt}" not found — drop has no CBT to connect to.`,
          did, 'aerialDrops');
      }
    }

    // ── 2d. Remaining FK checks (duct, chamber, UPRN, fibre assignments) ────
    // Closes the last gaps vs v2's validate_integrity.py DIRECT_CHECKS list.

    // Cables: duct_id, when set, must resolve to a real duct. duct_id is
    // legitimately null when no matching duct was found at digitise time
    // (e.g. an aerial cable, or a UG cable digitised before its duct) — that's
    // a normal, expected state, not an error. Only a SET-but-dangling
    // reference (duct existed, then got deleted) is flagged.
    for (const cable of (store.cables || [])) {
      const p = cable.properties || {};
      const cid = p.cable_id || '?';
      if (p.duct_id && !ductIds.has(String(p.duct_id))) {
        add(issues, 'error', 'Broken connectivity',
          `Cable ${cid}: duct_id "${p.duct_id}" not found — was the duct deleted after this cable was matched to it?`,
          cid, 'cables');
      }
    }

    // Joints: chamber_id must resolve to a real chamber. Unlike duct_id above,
    // chamber_id is set by the Joint tool only when snapped to an existing
    // Chamber feature — it should never legitimately be missing or dangling,
    // so a broken reference here specifically means the chamber was deleted
    // out from under an existing joint.
    for (const joint of (store.joints || [])) {
      const p = joint.properties || {};
      const jid = p.joint_id || '?';
      if (p.chamber_id && !chamberIds.has(String(p.chamber_id))) {
        add(issues, 'error', 'Broken connectivity',
          `Joint ${jid}: chamber_id "${p.chamber_id}" not found — was the chamber deleted after this joint was placed?`,
          jid, 'joints');
      }
    }

    // Bundles: uprn, when set, must resolve to a real address point. Like
    // duct_id, a null uprn is a normal unmatched state (premise not yet
    // imported, or matched manually later) — only a set-but-dangling
    // reference is flagged.
    for (const bundle of (store.bundles || [])) {
      const p = bundle.properties || {};
      const bid = p.bundle_id || '?';
      if (p.uprn && !addressUprns.has(String(p.uprn))) {
        add(issues, 'error', 'Broken connectivity',
          `Bundle ${bid}: uprn "${p.uprn}" not found in imported address points.`,
          bid, 'bundles');
      }
    }

    // Fibre assignments: joint_id / cable_id / bundle_id are DELIBERATELY
    // role-aware here, not a blind "must exist in collection X" check —
    // fibreAssign.js reuses cable_id and bundle_id for synthetic values
    // depending on fibre_role (see fibreAssign.js's rec() call sites), so a
    // naive check would false-positive on every legitimate synthetic record:
    //   - joint_id is always a real joint or CBT id — safe to check directly.
    //   - cable_id is either a real cable id, OR a synthetic splitter pigtail
    //     id in the fixed "<jointId>-SP" convention (fibreAssign.js's `spid`).
    //     Only flag when it's neither.
    //   - bundle_id is either a real bundle/aerial-drop consumer id (Stage 2
    //     terminal splitters), OR a downstream child joint/CBT id (Stage 1
    //     feeder splitters — v2 field convention). Only flag when it's none
    //     of those.
    for (const assignment of (store.fibreAssignments || [])) {
      const p = assignment.properties || assignment || {};
      const aid = p.assign_id || '?';

      if (p.joint_id && !jointIds.has(String(p.joint_id)) && !cbtIds.has(String(p.joint_id))) {
        add(issues, 'error', 'Broken connectivity',
          `Fibre assignment ${aid}: joint_id "${p.joint_id}" not found as a joint or CBT.`,
          aid, 'fibreAssignments');
      }

      if (p.cable_id && !String(p.cable_id).endsWith('-SP') && !cableIds.has(String(p.cable_id))) {
        add(issues, 'error', 'Broken connectivity',
          `Fibre assignment ${aid}: cable_id "${p.cable_id}" not found — was the cable deleted after fibres were assigned?`,
          aid, 'fibreAssignments');
      }

      if (p.bundle_id
          && !jointIds.has(String(p.bundle_id)) && !cbtIds.has(String(p.bundle_id))
          && !bundleIds.has(String(p.bundle_id)) && !aerialDropIds.has(String(p.bundle_id))) {
        add(issues, 'error', 'Broken connectivity',
          `Fibre assignment ${aid}: bundle_id "${p.bundle_id}" does not match any bundle, aerial drop, joint, or CBT — dangling reference.`,
          aid, 'fibreAssignments');
      }
    }

    ran.integrity = true;
  } catch (e) {
    add(issues, 'warning', 'Integrity check unavailable',
      `Network integrity check could not run: ${e.message}`, '', '');
  }

  // ── 3. Design completeness (INFO only, does not affect verdict tier) ───────
  try {
    const cables      = (store.cables || []).length;
    const spans       = (store.spans  || []).length;
    const assignments = (store.fibreAssignments || []).length;

    if (cables + spans === 0) {
      add(issues, 'info', 'No cables',
        'No cables or aerial spans digitised yet.', '', '');
    }
    if (assignments === 0 && cables + spans > 0) {
      add(issues, 'info', 'No fibre assignments',
        'Run Auto-Assign Fibres to assign fibre cores to premises before exporting splice plans.', '', '');
    }
    ran.structure = true;
  } catch (e) {
    add(issues, 'info', 'Structure check skipped',
      `Structural check could not run: ${e.message}`, '', '');
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  const errorCount   = issues.filter(i => i.tier === 'error').length;
  const warningCount = issues.filter(i => i.tier === 'warning').length;
  const infoCount    = issues.filter(i => i.tier === 'info').length;

  let verdict, headline;
  if (errorCount > 0) {
    verdict  = VERDICT.NOGO;
    headline = `${errorCount} blocking issue(s) found — the network as drawn would not fully work if built.`;
  } else if (warningCount > 0) {
    verdict  = VERDICT.CAUTION;
    headline = `No blocking faults — the built network would work. ${warningCount} caution(s) to review.`;
  } else {
    verdict  = VERDICT.GO;
    headline = 'The network as drawn would work if built. No faults found.';
  }

  return {
    verdict, headline,
    errorCount, warningCount, infoCount,
    routed, partial, unserved, total,
    issues, ran,
  };
}
