// optical.js — Conductor optical power budget calculator
// Ported verbatim from conductor_v2/tools/optical_budget.py (the pure-maths core).
// No map / backend dependency: same defaults, same formulae, same numbers as the
// QGIS plugin's Fibre Trace popup. QgsSettings is replaced by the plain DEFAULTS
// object below; override by passing your own `optical` object.
//
// UK GPON/XGS-PON defaults assume G.652D fibre at 1310/1550nm.

// ── Defaults (mirror DEFAULT_OPTICAL) ───────────────────────────────────────
export const DEFAULT_OPTICAL = {
  fibre_atten_db_km: 0.25,   // G.652D @ 1310/1550nm
  splice_loss_db:    0.10,   // per fusion splice (through joint)
  connector_loss_db: 1.50,   // flat termination allowance — POP + CBT + ONT (3 × 0.5dB)
  link_class:        'B+',
  safety_margin_db:  3.0,
};

export const DEFAULT_SPLITTER_LOSS_DB = {
  '1:2':  3.5,
  '1:4':  7.0,
  '1:8':  10.5,
  '1:16': 14.0,
  '1:32': 17.5,
};

// GPON/XGS-PON optical link class budgets (Tx min − Rx sensitivity), dB
export const LINK_CLASS_BUDGET_DB = {
  'B+': 28.0,
  'C+': 32.0,
};

// Build a full optical settings object from defaults (stands in for load_optical()).
export function defaultOptical() {
  return {
    ...DEFAULT_OPTICAL,
    splitter_loss_db: { ...DEFAULT_SPLITTER_LOSS_DB },
  };
}

// ── Loss / budget helpers ───────────────────────────────────────────────────

// splitter_loss_for_ratio: ratio string ('1:8') → insertion loss dB.
// Falls back to theoretical 10·log10(N) + 1.5dB for ratios not in the table.
export function splitterLossForRatio(ratioStr, splitterLossDb) {
  if (!ratioStr) return 0.0;
  const r = String(ratioStr).trim();
  if (splitterLossDb && r in splitterLossDb) return splitterLossDb[r];
  const m = r.match(/1\s*:\s*(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0) return 10 * Math.log10(n) + 1.5;
  }
  return 0.0;
}

// link_budget_db: usable budget for the configured class, after safety margin.
export function linkBudgetDb(optical) {
  const cls = optical.link_class ?? 'B+';
  const budget = LINK_CLASS_BUDGET_DB[cls] ?? LINK_CLASS_BUDGET_DB['B+'];
  return budget - (optical.safety_margin_db ?? DEFAULT_OPTICAL.safety_margin_db);
}

// ── Route loss calculation ──────────────────────────────────────────────────
// Pure version of the loss accumulation trace_premises() performs with the
// `breakdown` dict. Given the physical facts of a route, return loss, budget,
// margin and pass/fail — the same figures the plugin shows per premises.
//
//   fibreLengthM  — total fibre path length, metres
//   spliceCount   — number of through-joint fusion splices
//   splitters     — array of split-ratio strings along the path, e.g. ['1:4','1:8']
//   optical       — settings object (defaults to defaultOptical())
export function calculateRouteBudget(fibreLengthM, spliceCount, splitters = [], optical = null) {
  if (optical === null) optical = defaultOptical();

  const fibreDb     = (fibreLengthM / 1000) * optical.fibre_atten_db_km;
  const spliceDb    = spliceCount * optical.splice_loss_db;
  const splitterDb  = splitters.reduce(
    (sum, r) => sum + splitterLossForRatio(r, optical.splitter_loss_db), 0);
  const connectorDb = optical.connector_loss_db;

  const lossDb   = fibreDb + spliceDb + splitterDb + connectorDb;
  const budgetDb = linkBudgetDb(optical);
  const marginDb = budgetDb - lossDb;

  return {
    loss_db:   round2(lossDb),
    budget_db: round2(budgetDb),
    margin_db: round2(marginDb),
    link_pass: marginDb >= 0,
    breakdown: {
      fibre_db:     round2(fibreDb),
      splice_db:    round2(spliceDb),
      splitter_db:  round2(splitterDb),
      connector_db: round2(connectorDb),
      fibre_length_m: fibreLengthM,
      splice_count:   spliceCount,
      splitters:      splitters,
    },
  };
}

function round2(x) { return Math.round(x * 100) / 100; }
