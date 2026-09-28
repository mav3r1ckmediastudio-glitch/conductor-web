// wirelessInputs.js — Canonical fingerprint of every project field that can
// affect a wireless link analysis or coverage result.
//
// Same role as fibrePlanInputs.js: an analysis stored as VALIDATED is only
// trusted while its stored hash equals the hash of the CURRENT project. Any
// edit to a wireless input changes the hash and closes the gate until the
// analysis is re-run. Only RAW inputs are hashed (never derived results).
//
// Prefix 'w1-' is a FORMAT version for the canonical string. Bump it whenever
// canonicalWirelessInputs() changes shape so an old stored hash can never
// equal a new computed one.
//
// w2: survey_note added to LINK_KEYS. It is a required input of the surveyed-LOS
// override, so removing or changing it must make a stored analysis stale.
// w3: radio plausibility limits and the absorption threshold added to SETTINGS.
// w4: modelled oxygen-band absorption settings added.
// w5: replaced by ITU-R P.676 gas model settings (gasModel, temperature, humidity).
// w6: rain settings (design rain rate, availability target, clear-sky margin) added.

import { resolveWirelessSettings } from './wirelessSettings.js';

const P = (f) => (f && f.properties) || {};
const cell = (v) => (v === undefined || v === null ? '' : String(v));
const coord = (f) => {
  const c = f?.geometry?.coordinates;
  return Array.isArray(c) && c.length >= 2 ? `${Number(c[0]).toFixed(7)},${Number(c[1]).toFixed(7)}` : '';
};
const rows = (list, keys, withCoord) =>
  (list || []).map(f => [...keys.map(k => cell(P(f)[k])), withCoord ? coord(f) : ''].join('\x1f')).sort();

// Every setting that can change a verdict. Adding a setting means adding it here.
export const SETTING_KEYS = ['kFactor', 'minFresnelClearancePct', 'minFadeMarginDb', 'coverageMarginDb', 'profileStepM',
                             'terrainZoom', 'terrainSourceId', 'freqMinGhz', 'freqMaxGhz', 'txPowerMinDbm', 'txPowerMaxDbm',
                             'gainMinDbi', 'gainMaxDbi', 'rxSensMinDbm', 'rxSensMaxDbm', 'maxLossDb', 'absorptionAboveGhz',
                             'gasModel', 'gasTemperatureC', 'gasWaterVapourGm3',
                             'rainAssessAboveGhz', 'rainRate001Mmh', 'minAvailabilityPct', 'minClearSkyMarginDb'];
export const SITE_KEYS   = ['site_id', 'mast_height_m', 'ground_override_m'];
export const SECTOR_KEYS = ['sector_id', 'site_id', 'azimuth_deg', 'beamwidth_deg', 'freq_ghz', 'tx_power_dbm',
                            'gain_dbi', 'cable_loss_db', 'antenna_height_m', 'range_m',
                            'cpe_height_m', 'cpe_gain_dbi', 'cpe_min_rx_dbm'];
export const LINK_KEYS   = ['link_id', 'site_a', 'site_b', 'freq_ghz', 'channel_width_mhz',
                            'tx_power_a_dbm', 'gain_a_dbi', 'cable_loss_a_db', 'rx_sensitivity_a_dbm', 'antenna_height_a_m',
                            'tx_power_b_dbm', 'gain_b_dbi', 'cable_loss_b_db', 'rx_sensitivity_b_dbm', 'antenna_height_b_m',
                            'extra_loss_db', 'survey_los_confirmed', 'survey_note'];

export function canonicalWirelessInputs(state) {
  if (!state) return '';
  const s = resolveWirelessSettings(state.wirelessSettings);
  const parts = [];
  parts.push('SETTINGS\x1e' + SETTING_KEYS.map(k => cell(s[k])).join('\x1f'));
  parts.push('SITES\x1e' + rows(state.wirelessSites, SITE_KEYS, true).join('\x1d'));
  parts.push('SECTORS\x1e' + rows(state.wirelessSectors, SECTOR_KEYS, false).join('\x1d'));
  parts.push('LINKS\x1e' + rows(state.wirelessLinks, LINK_KEYS, false).join('\x1d'));
  return parts.join('\n');
}

function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; return h; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h >>> 0; }

/** Change-detection fingerprint (not a security hash). */
export function hashWirelessInputs(state) {
  const s = canonicalWirelessInputs(state);
  return 'w6-' + djb2(s).toString(16).padStart(8, '0') + fnv1a(s).toString(16).padStart(8, '0') + '-' + s.length.toString(16);
}
