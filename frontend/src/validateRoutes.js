// validateRoutes.js — Fibre route validator for Conductor Web.
// Topology-agnostic: ROUTED = continuous path to cabinet, PARTIAL = path
// breaks before cabinet, UNSERVED = no entry asset. No operator-specific
// splitter chain rules — those belong in Design Health, not here.
//
// Re-uses traceFibre() from fibreTrace.js as the BFS engine. validateAllRoutes
// runs it over every address point. computeSummary adds fibre/duct lengths and
// BoM cost for the stats bar.
//
// Exports:
//   validateAllRoutes(store, onProgress?)  → { results[], summary }
//   computeSummary(store)                  → { premises, routed, partial,
//                                              unserved, fibre_km, duct_km,
//                                              materials_cost, stale }

import { traceFibre, STATUS_OK, STATUS_PARTIAL, STATUS_UNSERVED } from './fibreTrace.js';
import { buildBom } from './bom.js';

function S(v) { return (v === null || v === undefined) ? '' : String(v); }
function r2(v) { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }

// ── Route validation ──────────────────────────────────────────────────────────

export function validateAllRoutes(store, onProgress = null) {
  const points = store.addressPoints || [];
  const total  = points.length;

  const results = [];
  const summary = { premises: total, routed: 0, partial: 0, unserved: 0 };

  for (let i = 0; i < points.length; i++) {
    const ap   = points[i];
    const uprn = S(ap.properties?.uprn);
    const addr = S(ap.properties?.address || ap.properties?.postcode || uprn);

    let result;
    try {
      result = traceFibre(store, uprn);
    } catch (e) {
      result = {
        status: STATUS_PARTIAL,
        reason: `Trace error: ${e.message}`,
        uprn, hops: [], lengthM: 0, edges: [],
      };
    }

    const { status, reason, lengthM, hops } = result;

    if      (status === STATUS_OK)       summary.routed++;
    else if (status === STATUS_PARTIAL)  summary.partial++;
    else                                 summary.unserved++;

    results.push({ uprn, address: addr, status, reason, lengthM, hops });

    if (onProgress) onProgress(i + 1, total);
  }

  return { results, summary };
}

// ── Stats bar summary ─────────────────────────────────────────────────────────
// Computes all seven stats-bar values. The route validation pass (ROUTES /
// PARTIAL / UNSERVED) is the expensive part; the rest are simple length sums.
// Caller decides when to run this (on-demand, not reactive).

export function computeSummary(store) {
  // Cheap stats — no BFS needed
  const premises = (store.addressPoints || []).length;

  // Fibre km: cables + spans + bundles + aerialDrops + cbtTails
  let fibreM = 0;
  for (const c of [...(store.cables||[]), ...(store.spans||[]),
                   ...(store.bundles||[]), ...(store.aerialDrops||[]),
                   ...(store.cbtTails||[])]) {
    fibreM += parseFloat(c.properties?.length_m || 0) || 0;
  }
  const fibre_km = r2(fibreM / 1000);

  // Duct km: ducts + dropDucts
  let ductM = 0;
  for (const d of [...(store.ducts||[]), ...(store.dropDucts||[])]) {
    ductM += parseFloat(d.properties?.length_m || 0) || 0;
  }
  const duct_km = r2(ductM / 1000);

  // Materials cost
  let materials_cost = 0;
  try {
    const { grandTotal } = buildBom(store);
    materials_cost = grandTotal;
  } catch (e) {
    console.error('[validateRoutes] BoM calculation failed — materials_cost will read as 0, not a real total:', e);
  }

  // Route validation pass
  const { summary } = validateAllRoutes(store);

  return {
    premises,
    routed:   summary.routed,
    partial:  summary.partial,
    unserved: summary.unserved,
    fibre_km,
    duct_km,
    materials_cost,
    stale: false,
  };
}
