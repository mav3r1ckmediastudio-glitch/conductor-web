// cabinetCost.js — Cabinet Cost Calculator for Conductor Web.
//
// The BoM (buildBom) is the single source of truth for all project costs,
// including cabinet equipment. This module is a thin wrapper that pulls the
// BoM result and adds the per-premise figure — no separate calculation.
//
// Cabinet equipment fields (dux_shelves, calix_shelves, gpon_cards, etc.) are
// read inside buildBom() and appear under the "Network Equip" section. The
// stats bar "Est. Materials" total therefore already includes equipment costs.
//
// Exports:
//   buildCabinetCost(store, costs?)  → result object or null (no cabinet)

import { DEFAULT_COSTS, buildBom } from './bom.js';

/**
 * Returns:
 * {
 *   sections:    BoM sections array (same shape as buildBom)
 *   grandTotal:  number — full project cost including equipment
 *   premises:    number
 *   perPremise:  number
 *   popName:     string
 *   popType:     string
 *   equipSection: { name, rows, subtotal } — the Network Equip section
 * }
 * Returns null if no cabinet has been placed.
 */
export function buildCabinetCost(store, costs = DEFAULT_COSTS) {
  if (!store.cabinet) return null;

  const { sections, grandTotal } = buildBom(store, costs);

  const premises   = (store.addressPoints || []).length;
  const perPremise = premises > 0 ? Math.round(grandTotal / premises * 100) / 100 : 0;
  const equipSection = sections.find(s => s.name === 'Network Equip') || { name: 'Network Equip', rows: [], subtotal: 0 };

  return {
    sections,
    grandTotal,
    premises,
    perPremise,
    equipSection,
    popName: String(store.cabinet.properties?.pop_name || store.cabinet.properties?.pop_id || ''),
    popType: String(store.cabinet.properties?.pop_type || ''),
  };
}
