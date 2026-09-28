// wirelessAnalysis.js
// Pure link-by-link wireless analysis: completeness -> path profile -> budget ->
// verdict. Produces the object stored as `wirelessAnalysis` and gated on the
// input fingerprint (wirelessInputs.js), exactly like the splice-plan gate.
//
// "VALIDATED" here means AUTOMATED checks passed. It is NOT engineering
// approval — a qualified wireless engineer must still review a design.
//
// Issue codes (stable identifiers, used by the UI and tests):
//   SITE_PARAMS_INCOMPLETE  SITE_DUPLICATE_ID
//   LINK_ENDPOINT_MISSING   LINK_SAME_SITE        LINK_PARAMS_INCOMPLETE
//   LINK_NO_TERRAIN         LINK_TERRAIN_PARTIAL  LINK_OBSTRUCTED
//   LINK_FRESNEL_FAIL       LINK_MARGIN_LOW       LINK_SURVEYED_LOS (warning)
//   SECTOR_SITE_MISSING     SECTOR_PARAMS_INCOMPLETE
//   LINK_PARAMS_IMPLAUSIBLE SECTOR_PARAMS_IMPLAUSIBLE  (outside the editable radio limits)
//   LINK_ABSORPTION_UNMODELLED SECTOR_ABSORPTION_UNMODELLED

import { resolveWirelessSettings } from './wirelessSettings.js';
import { hashWirelessInputs } from './wirelessInputs.js';
import { buildProfile } from './wirelessProfile.js';
import { computeLinkBudget } from './wirelessLinkBudget.js';
import { groundDistanceM } from './wirelessGeo.js';

const P = (f) => (f && f.properties) || {};
export const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const lngLat = (f) => {
  const c = f?.geometry?.coordinates;
  return Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lng: c[0], lat: c[1] } : null;
};
const issue = (code, message, scope, id, severity = 'error') => ({ code, message, scope, id, severity });

/** Required numeric link fields (cable loss and extra loss are optional, default 0). */
export const LINK_REQUIRED = [
  ['freq_ghz', 'frequency (GHz)', (v) => v > 0],
  ['tx_power_a_dbm', 'Tx power at A (dBm)'], ['gain_a_dbi', 'antenna gain at A (dBi)'], ['rx_sensitivity_a_dbm', 'Rx sensitivity at A (dBm)'],
  ['tx_power_b_dbm', 'Tx power at B (dBm)'], ['gain_b_dbi', 'antenna gain at B (dBi)'], ['rx_sensitivity_b_dbm', 'Rx sensitivity at B (dBm)'],
];
export const SECTOR_REQUIRED = [
  ['azimuth_deg', 'azimuth (deg)', (v) => v >= 0 && v < 360],
  ['beamwidth_deg', 'beamwidth (deg)', (v) => v > 0 && v <= 360],
  ['freq_ghz', 'frequency (GHz)', (v) => v > 0],
  ['tx_power_dbm', 'Tx power (dBm)'], ['gain_dbi', 'antenna gain (dBi)'],
  ['antenna_height_m', 'antenna height AGL (m)', (v) => v >= 0],
  ['range_m', 'analysis range (m)', (v) => v >= 100 && v <= 30000],
  ['cpe_height_m', 'CPE height AGL (m)', (v) => v >= 0],
  ['cpe_gain_dbi', 'CPE gain (dBi)'], ['cpe_min_rx_dbm', 'CPE minimum Rx (dBm)'],
];

function missingFields(props, spec) {
  const out = [];
  for (const [key, label, ok] of spec) {
    const v = num(props[key]);
    if (v == null || (ok && !ok(v))) out.push(label);
  }
  return out;
}


/**
 * Radio values outside the project's plausibility limits (settings). Catches
 * typos and unit mistakes before they become an impossible link budget.
 * @param checks  [value, label, lo, hi] — value already parsed with num()
 * @returns human-readable problems, e.g. "antenna gain at A is 300 (allowed 0 to 50)"
 */
export function implausibleValues(checks) {
  const out = [];
  for (const [v, label, lo, hi] of checks) {
    if (v == null) continue;                        // absence is handled by the completeness check
    if (v < lo || v > hi) out.push(`${label} is ${v} (allowed ${lo} to ${hi})`);
  }
  return out;
}
const LIMITS_HINT = 'Correct the value, or change the limit in Engineering thresholds if it is genuinely right.';

export function checkSector(sector, sitesById, settings = resolveWirelessSettings(null)) {
  const p = P(sector);
  const id = p.sector_id || '(unnamed sector)';
  const issues = [];
  if (!sitesById.has(String(p.site_id ?? ''))) {
    issues.push(issue('SECTOR_SITE_MISSING', `Sector ${id} references site "${p.site_id ?? ''}" which does not exist.`, 'sector', id));
  }
  const missing = missingFields(p, SECTOR_REQUIRED);
  if (missing.length) issues.push(issue('SECTOR_PARAMS_INCOMPLETE', `Sector ${id} is missing or has invalid: ${missing.join(', ')}.`, 'sector', id));
  const S = settings;
  const bad = implausibleValues([
    [num(p.freq_ghz), 'frequency (GHz)', S.freqMinGhz, S.freqMaxGhz],
    [num(p.tx_power_dbm), 'Tx power (dBm)', S.txPowerMinDbm, S.txPowerMaxDbm],
    [num(p.gain_dbi), 'antenna gain (dBi)', S.gainMinDbi, S.gainMaxDbi],
    [num(p.cable_loss_db), 'cable/connector loss (dB)', 0, S.maxLossDb],
    [num(p.cpe_gain_dbi), 'CPE gain (dBi)', S.gainMinDbi, S.gainMaxDbi],
    [num(p.cpe_min_rx_dbm), 'CPE minimum Rx (dBm)', S.rxSensMinDbm, S.rxSensMaxDbm],
  ]);
  if (bad.length) issues.push(issue('SECTOR_PARAMS_IMPLAUSIBLE', `Sector ${id}: ${bad.join('; ')}. ${LIMITS_HINT}`, 'sector', id));
  const f = num(p.freq_ghz);
  if (f != null && f > S.absorptionAboveGhz) {
    issues.push(issue('SECTOR_ABSORPTION_UNMODELLED', `Sector ${id}: ${f} GHz is above ${S.absorptionAboveGhz} GHz, where atmospheric absorption is significant and the coverage model does not include it.`, 'sector', id));
  }
  return issues;
}

function analyseLink(link, sitesById, terrain, settings) {
  const p = P(link);
  const id = p.link_id || '(unnamed link)';
  const issues = [];
  const res = { link_id: id, verdict: 'FAIL', issues, distanceKm: null, terrainStatus: null,
                fresnelWorstPct: null, clearanceWorstM: null, worstAtKm: null,
                rxAtoBDbm: null, rxBtoADbm: null, fadeAtoBDb: null, fadeBtoADb: null, fadeMarginDb: null, surveyed: false };

  const sa = sitesById.get(String(p.site_a ?? '')), sb = sitesById.get(String(p.site_b ?? ''));
  if (!sa || !sb) {
    issues.push(issue('LINK_ENDPOINT_MISSING', `Link ${id}: ${!sa ? `site A "${p.site_a ?? ''}"` : `site B "${p.site_b ?? ''}"`} does not exist.`, 'link', id));
    return res;
  }
  const A = lngLat(sa), B = lngLat(sb);
  if (!A || !B || String(p.site_a) === String(p.site_b) || groundDistanceM(A, B) < 1) {
    issues.push(issue('LINK_SAME_SITE', `Link ${id}: endpoints are the same site or less than 1 m apart.`, 'link', id));
    return res;
  }

  const missing = missingFields(p, LINK_REQUIRED);
  const aglA = num(p.antenna_height_a_m) ?? num(P(sa).mast_height_m);
  const aglB = num(p.antenna_height_b_m) ?? num(P(sb).mast_height_m);
  if (aglA == null || aglA < 0) missing.push('antenna height at A (link value or site mast height)');
  if (aglB == null || aglB < 0) missing.push('antenna height at B (link value or site mast height)');
  const surveyed = p.survey_los_confirmed === true;
  if (surveyed && !String(p.survey_note ?? '').trim()) missing.push('survey note (required when LOS is marked surveyed)');
  if (missing.length) {
    issues.push(issue('LINK_PARAMS_INCOMPLETE', `Link ${id} is missing or has invalid: ${missing.join(', ')}.`, 'link', id));
    return res;
  }

  const S = settings;
  const bad = implausibleValues([
    [num(p.freq_ghz), 'frequency (GHz)', S.freqMinGhz, S.freqMaxGhz],
    [num(p.tx_power_a_dbm), 'Tx power at A (dBm)', S.txPowerMinDbm, S.txPowerMaxDbm],
    [num(p.tx_power_b_dbm), 'Tx power at B (dBm)', S.txPowerMinDbm, S.txPowerMaxDbm],
    [num(p.gain_a_dbi), 'antenna gain at A (dBi)', S.gainMinDbi, S.gainMaxDbi],
    [num(p.gain_b_dbi), 'antenna gain at B (dBi)', S.gainMinDbi, S.gainMaxDbi],
    [num(p.rx_sensitivity_a_dbm), 'Rx sensitivity at A (dBm)', S.rxSensMinDbm, S.rxSensMaxDbm],
    [num(p.rx_sensitivity_b_dbm), 'Rx sensitivity at B (dBm)', S.rxSensMinDbm, S.rxSensMaxDbm],
    [num(p.cable_loss_a_db), 'cable/connector loss at A (dB)', 0, S.maxLossDb],
    [num(p.cable_loss_b_db), 'cable/connector loss at B (dB)', 0, S.maxLossDb],
    [num(p.extra_loss_db), 'extra path loss (dB)', 0, S.maxLossDb],
  ]);
  if (bad.length) {
    // Never compute a budget from impossible inputs: its figures would be shown.
    issues.push(issue('LINK_PARAMS_IMPLAUSIBLE', `Link ${id}: ${bad.join('; ')}. ${LIMITS_HINT}`, 'link', id));
    return res;
  }

  const freq = num(p.freq_ghz);
  // Free-space + declared extra loss only. Above the absorption threshold that
  // model is badly optimistic, so an explicit allowance is required. This is
  // not waivable by a line-of-sight survey (it is a budget issue, not LOS).
  if (freq > S.absorptionAboveGhz && !((num(p.extra_loss_db) ?? 0) > 0)) {
    issues.push(issue('LINK_ABSORPTION_UNMODELLED', `Link ${id}: ${freq} GHz is above ${S.absorptionAboveGhz} GHz, where atmospheric absorption is significant (around 15 dB per km near 60 GHz) and is not modelled. Enter an extra path loss allowance for this link.`, 'link', id));
  }
  const profile = buildProfile(
    terrain,
    { ...A, antennaAglM: aglA, groundM: num(P(sa).ground_override_m) ?? undefined },
    { ...B, antennaAglM: aglB, groundM: num(P(sb).ground_override_m) ?? undefined },
    { freqGHz: freq, kFactor: settings.kFactor, stepM: settings.profileStepM },
  );
  res.profile = profile;
  res.distanceKm = profile.distanceKm;
  res.terrainStatus = profile.status;
  res.surveyed = surveyed;
  if (profile.worst) { res.fresnelWorstPct = profile.worst.clearancePct; res.clearanceWorstM = profile.worst.clearanceM; res.worstAtKm = profile.worst.atKm; }

  // Path clearance
  let clearanceFailed = false;
  if (profile.status === 'NO_TERRAIN') {
    issues.push(issue('LINK_NO_TERRAIN', `Link ${id}: no terrain data along the path, so line-of-sight cannot be verified.`, 'link', id));
    clearanceFailed = true;
  } else if (profile.status === 'PARTIAL') {
    issues.push(issue('LINK_TERRAIN_PARTIAL', `Link ${id}: terrain data is missing for ${profile.missingSamples} point(s) along the path, so line-of-sight cannot be fully verified.`, 'link', id));
    clearanceFailed = true;
  } else if (profile.worst.clearanceM < 0) {
    issues.push(issue('LINK_OBSTRUCTED', `Link ${id}: terrain obstructs the direct path by ${(-profile.worst.clearanceM).toFixed(1)} m at ${profile.worst.atKm.toFixed(2)} km.`, 'link', id));
    clearanceFailed = true;
  } else if (profile.worst.clearancePct < settings.minFresnelClearancePct) {
    issues.push(issue('LINK_FRESNEL_FAIL', `Link ${id}: worst Fresnel clearance is ${profile.worst.clearancePct.toFixed(0)}% at ${profile.worst.atKm.toFixed(2)} km; ${settings.minFresnelClearancePct}% required.`, 'link', id));
    clearanceFailed = true;
  }
  if (clearanceFailed && surveyed) {
    issues.push(issue('LINK_SURVEYED_LOS', `Link ${id}: modelled clearance check waived on the strength of a recorded site survey ("${String(p.survey_note).trim()}"). This is an explicit engineering override.`, 'link', id, 'warning'));
  }

  // Link budget, both directions (free-space + declared extra loss)
  const common = { freqGHz: freq, distanceKm: profile.distanceKm, extraLossDb: num(p.extra_loss_db) ?? 0 };
  const ab = computeLinkBudget({ ...common, txPowerDbm: num(p.tx_power_a_dbm), txGainDbi: num(p.gain_a_dbi), txCableLossDb: num(p.cable_loss_a_db) ?? 0,
    rxGainDbi: num(p.gain_b_dbi), rxCableLossDb: num(p.cable_loss_b_db) ?? 0, rxSensitivityDbm: num(p.rx_sensitivity_b_dbm) });
  const ba = computeLinkBudget({ ...common, txPowerDbm: num(p.tx_power_b_dbm), txGainDbi: num(p.gain_b_dbi), txCableLossDb: num(p.cable_loss_b_db) ?? 0,
    rxGainDbi: num(p.gain_a_dbi), rxCableLossDb: num(p.cable_loss_a_db) ?? 0, rxSensitivityDbm: num(p.rx_sensitivity_a_dbm) });
  res.rxAtoBDbm = ab.rxPowerDbm; res.rxBtoADbm = ba.rxPowerDbm;
  res.fadeAtoBDb = ab.fadeMarginDb; res.fadeBtoADb = ba.fadeMarginDb;
  res.fadeMarginDb = Math.min(ab.fadeMarginDb, ba.fadeMarginDb);
  res.fsplDb = ab.fsplDb;
  if (res.fadeMarginDb < settings.minFadeMarginDb) {
    issues.push(issue('LINK_MARGIN_LOW', `Link ${id}: fade margin is ${res.fadeMarginDb.toFixed(1)} dB (worst direction); ${settings.minFadeMarginDb} dB required.`, 'link', id));
  }

  const blocking = issues.filter(i => i.severity === 'error');
  const clearanceWaived = clearanceFailed && surveyed;
  const stillBlocking = blocking.filter(i => !(clearanceWaived && ['LINK_NO_TERRAIN', 'LINK_TERRAIN_PARTIAL', 'LINK_OBSTRUCTED', 'LINK_FRESNEL_FAIL'].includes(i.code)));
  res.verdict = stillBlocking.length ? 'FAIL' : 'PASS';
  // A waived clearance issue is downgraded from error to warning so it does not read as a failure.
  if (clearanceWaived) for (const i of issues) if (['LINK_NO_TERRAIN', 'LINK_TERRAIN_PARTIAL', 'LINK_OBSTRUCTED', 'LINK_FRESNEL_FAIL'].includes(i.code)) i.severity = 'waived';
  return res;
}

/**
 * Analyse every wireless asset in `state`.
 * @param terrain TerrainSource (already loaded for all link paths)
 * @returns the object persisted as state.wirelessAnalysis (minus computedAt, added by the store)
 */
export function analyseWireless(state, terrain) {
  return analyseWirelessDetailed(state, terrain).analysis;
}

/**
 * Same as analyseWireless but also returns the full per-link path profiles
 * (hundreds of samples each) for on-screen charts. Profiles are NOT part of the
 * persisted analysis — they are re-derivable from terrain + inputs.
 * @returns {{ analysis: object, profiles: Map<string, object> }}
 */
export function analyseWirelessDetailed(state, terrain) {
  const settings = resolveWirelessSettings(state.wirelessSettings);
  const sites = state.wirelessSites || [], links = state.wirelessLinks || [], sectors = state.wirelessSectors || [];
  const issues = [];

  const sitesById = new Map();
  for (const s of sites) {
    const sid = String(P(s).site_id ?? '');
    if (sitesById.has(sid)) issues.push(issue('SITE_DUPLICATE_ID', `Site ID "${sid}" is used more than once.`, 'site', sid));
    sitesById.set(sid, s);
    const mast = num(P(s).mast_height_m);
    if (mast == null || mast < 0) issues.push(issue('SITE_PARAMS_INCOMPLETE', `Site ${sid} has no valid mast height.`, 'site', sid));
  }

  const linkResults = links.map(l => analyseLink(l, sitesById, terrain, settings));
  for (const r of linkResults) issues.push(...r.issues);
  for (const s of sectors) issues.push(...checkSector(s, sitesById, settings));

  const blocking = issues.filter(i => i.severity === 'error');
  const anyAsset = links.length + sectors.length > 0;
  const status = anyAsset && blocking.length === 0 && linkResults.every(r => r.verdict === 'PASS') ? 'VALIDATED' : 'INVALID';

  const profiles = new Map();
  for (const r of linkResults) if (r.profile) profiles.set(r.link_id, r.profile);
  const analysis = {
    status,
    inputHash: hashWirelessInputs(state),
    terrainId: terrain?.id ?? null,
    terrainModel: terrain?.model ?? null,
    terrainResolutionM: terrain?.resolutionM ?? null,
    settings,
    links: linkResults.map(({ profile, ...rest }) => ({ ...rest, profileSummary: profile ? { status: profile.status, missingSamples: profile.missingSamples, params: profile.params } : null })),
    issues,
    counts: { sites: sites.length, links: links.length, sectors: sectors.length, pass: linkResults.filter(r => r.verdict === 'PASS').length },
  };
  return { analysis, profiles };
}

/** The wireless gate: VALIDATED status AND stored hash === hash of the current project. */
export function wirelessPlanReady(state) {
  const a = state?.wirelessAnalysis;
  return !!a && a.status === 'VALIDATED' && a.inputHash === hashWirelessInputs(state);
}

/** 'NONE' | 'UNVERIFIED' | 'STALE' | 'INVALID' | 'VALIDATED' — for UI badges. */
export function wirelessPlanState(state) {
  const a = state?.wirelessAnalysis;
  const any = (state?.wirelessSites?.length || 0) + (state?.wirelessLinks?.length || 0) + (state?.wirelessSectors?.length || 0) > 0;
  if (!any) return 'NONE';
  if (!a) return 'UNVERIFIED';
  if (a.inputHash !== hashWirelessInputs(state)) return 'STALE';
  return a.status === 'VALIDATED' ? 'VALIDATED' : 'INVALID';
}
