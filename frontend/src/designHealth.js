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

import { traceFibre } from './fibreTrace.js';

export const VERDICT = { GO: 'GO', CAUTION: 'CAUTION', NOGO: 'NO-GO' };

function add(issues, tier, category, message, assetId = '', layer = '') {
  issues.push({ tier, category, message, assetId, layer });
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
  //   PARTIAL  → ERROR   (premises would be dark fibre if built)
  //   UNSERVED → WARNING (incomplete design; built portion still works)
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
      const PARTIAL_CAP = 10; // prevent flooding with thousands of individual rows
      let partialShown = 0;

      for (const ap of addressPoints) {
        const r = traceFibre(store, ap.properties?.uprn);
        if (r.status === 'ROUTED') {
          routed++;
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
      // Unserved = incomplete design, NOT a broken network. Caution only.
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
  // Broken cross-asset node references = topology broken = would not route.
  try {
    // Build ID lookup sets for each asset type
    const chamberIds = new Set(
      (store.chambers || []).map(f => f.properties?.chamber_id).filter(Boolean));
    const jointIds = new Set(
      (store.joints || []).map(f => f.properties?.joint_id).filter(Boolean));
    const poleIds = new Set(
      (store.poles || []).map(f => f.properties?.pole_id).filter(Boolean));
    const cbtIds = new Set(
      (store.cbts || []).map(f => f.properties?.cbt_id).filter(Boolean));

    // Union of all node IDs (for general endpoint checks)
    const allNodeIds = new Set([...chamberIds, ...jointIds, ...poleIds, ...cbtIds]);
    if (store.cabinet?.properties?.cabinet_id) {
      allNodeIds.add(store.cabinet.properties.cabinet_id);
    }

    // Aerial spans: both endpoints must resolve to a known node
    for (const span of (store.spans || [])) {
      const p = span.properties || {};
      const sid = p.span_id || '?';
      if (p.from_node && !allNodeIds.has(p.from_node)) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial span ${sid}: from_node "${p.from_node}" not found — topology broken.`,
          sid, 'spans');
      }
      if (p.to_node && !allNodeIds.has(p.to_node)) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial span ${sid}: to_node "${p.to_node}" not found — topology broken.`,
          sid, 'spans');
      }
    }

    // Aerial drops: from_node must resolve to a CBT or pole
    const aerialNodeIds = new Set([...poleIds, ...cbtIds]);
    for (const drop of (store.aerialDrops || [])) {
      const p = drop.properties || {};
      const did = p.drop_id || '?';
      if (p.from_node && !aerialNodeIds.has(p.from_node)) {
        add(issues, 'error', 'Broken connectivity',
          `Aerial drop ${did}: from_node "${p.from_node}" not found as a CBT or pole.`,
          did, 'aerialDrops');
      }
    }

    // CBT tails: cbt_id must resolve + 350m hard-stop check
    for (const tail of (store.cbtTails || [])) {
      const p = tail.properties || {};
      const tid = p.tail_id || '?';
      if (p.cbt_id && !cbtIds.has(p.cbt_id)) {
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

    ran.integrity = true;
  } catch (e) {
    add(issues, 'warning', 'Integrity check unavailable',
      `Network integrity check could not run: ${e.message}`, '', '');
  }

  // ── 3. Design completeness (INFO only, does not affect verdict tier) ───────
  // These are completeness / cost-accuracy flags, not function-blocking.
  try {
    const cables = (store.cables || []).length;
    const spans  = (store.spans  || []).length;
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
