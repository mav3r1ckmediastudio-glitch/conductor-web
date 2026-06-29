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
// Check 1b — No passive splitter on a ROUTED path (operator-agnostic PON requirement)
// Check 2  — Topology / FK integrity (spans, drops, tails, cables, bundles)
// Check 2b — Splitter capacity & declaration (overcapacity→ERROR, undeclared→WARNING)
// Check 2c — Broader FK integrity (cables from/to_node, bundles from_joint, drop from_cbt)
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
      const NO_SPLIT_CAP = 10;
      let partialShown   = 0;
      let noSplitCount   = 0;
      let noSplitShown   = 0;

      for (const ap of addressPoints) {
        const r = traceFibre(store, ap.properties?.uprn);

        if (r.status === 'ROUTED') {
          routed++;

          // Check 1b — splitter presence (operator-agnostic PON requirement).
          // traceFibre returns r.optical.breakdown.splitters[] for every ROUTED
          // path. An empty array means the route reaches the cabinet without
          // passing through any passive optical splitter — physically impossible
          // to serve a PON customer on this path regardless of operator topology.
          const splitters = r.optical?.breakdown?.splitters;
          if (splitters && splitters.length === 0) {
            noSplitCount++;
            if (noSplitShown < NO_SPLIT_CAP) {
              add(issues, 'error', 'No splitter on route',
                `Routed but no passive splitter found — cannot serve a PON customer: ${ap.properties?.address || ap.properties?.uprn || '?'}`,
                String(ap.properties?.uprn || ''), 'premises');
              noSplitShown++;
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
      if (noSplitCount > NO_SPLIT_CAP) {
        add(issues, 'error', 'No splitter on route',
          `…and ${noSplitCount - NO_SPLIT_CAP} more route(s) with no splitter — showing first ${NO_SPLIT_CAP} only.`,
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
    // Build ID lookup sets (used by 2a, 2b, 2c)
    const chamberIds = new Set(
      (store.chambers || []).map(f => String(f.properties?.chamber_id || '')).filter(Boolean));
    const jointIds = new Set(
      (store.joints || []).map(f => String(f.properties?.joint_id || '')).filter(Boolean));
    const poleIds = new Set(
      (store.poles || []).map(f => String(f.properties?.pole_id || '')).filter(Boolean));
    const cbtIds = new Set(
      (store.cbts || []).map(f => String(f.properties?.cbt_id || '')).filter(Boolean));

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
