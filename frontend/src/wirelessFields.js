// wirelessFields.js — Field specifications for the wireless forms. Pure data +
// pure helpers, so the required-ness of every field is defined in exactly one
// place and can be tested against the analysis rules (see wirelessFields.test.js).

import { LINK_REQUIRED, SECTOR_REQUIRED } from './wirelessAnalysis.js';

const n = (key, label, extra = {}) => ({ key, label, type: 'number', ...extra });

export const SITE_FIELDS = [
  { key: 'name', label: 'Name', type: 'text', section: 'Site' },
  n('mast_height_m', 'Structure height (m AGL)', { section: 'Site', required: true, min: 0, help: 'Height of the mast/tower/building above ground where antennas are mounted.' }),
  n('ground_override_m', 'Ground elevation override (m ASL)', { section: 'Site', help: 'Leave blank to use terrain data. Enter a surveyed value to override the terrain model.' }),
  { key: 'notes', label: 'Notes', type: 'text', section: 'Site' },
];

export const SECTOR_FIELDS = [
  n('azimuth_deg', 'Azimuth (deg true, 0-359)', { section: 'Antenna', required: true, min: 0, max: 359.999 }),
  n('beamwidth_deg', '3 dB beamwidth (deg)', { section: 'Antenna', required: true, min: 1, max: 360 }),
  n('freq_ghz', 'Frequency (GHz)', { section: 'Radio', required: true, min: 0.1 }),
  n('tx_power_dbm', 'Tx power (dBm)', { section: 'Radio', required: true }),
  n('gain_dbi', 'Antenna gain (dBi)', { section: 'Radio', required: true }),
  n('cable_loss_db', 'Cable / connector loss (dB)', { section: 'Radio', help: 'Blank = 0. Use 0 for integrated radios.' }),
  n('antenna_height_m', 'Antenna height (m AGL)', { section: 'Radio', required: true, min: 0 }),
  n('range_m', 'Analysis range (m, 100-30000)', { section: 'Coverage', required: true, min: 100, max: 30000 }),
  n('cpe_height_m', 'CPE height (m AGL)', { section: 'Customer equipment', required: true, min: 0 }),
  n('cpe_gain_dbi', 'CPE antenna gain (dBi)', { section: 'Customer equipment', required: true }),
  n('cpe_min_rx_dbm', 'CPE minimum Rx level (dBm)', { section: 'Customer equipment', required: true, help: 'Receiver sensitivity for the service rate you intend to sell.' }),
  { key: 'notes', label: 'Notes', type: 'text', section: 'Notes' },
];

const end = (s, L) => [
  n(`tx_power_${s}_dbm`, `Tx power at ${L} (dBm)`, { section: `End ${L}`, required: true }),
  n(`gain_${s}_dbi`, `Antenna gain at ${L} (dBi)`, { section: `End ${L}`, required: true }),
  n(`rx_sensitivity_${s}_dbm`, `Rx sensitivity at ${L} (dBm)`, { section: `End ${L}`, required: true, help: 'For the modulation/rate you are designing to.' }),
  n(`cable_loss_${s}_db`, `Cable / connector loss at ${L} (dB)`, { section: `End ${L}`, help: 'Blank = 0. Use 0 for integrated radios.' }),
  n(`antenna_height_${s}_m`, `Antenna height at ${L} (m AGL)`, { section: `End ${L}`, min: 0, help: "Blank = the site's structure height." }),
];
export const LINK_FIELDS = [
  n('freq_ghz', 'Frequency (GHz)', { section: 'Link', required: true, min: 0.1 }),
  n('channel_width_mhz', 'Channel width (MHz)', { section: 'Link', min: 1, help: 'Recorded for the design; not used in the free-space budget.' }),
  n('extra_loss_db', 'Extra path loss (dB)', { section: 'Link', help: 'Rain / foliage / other allowance. Blank = 0.' }),
  ...end('a', 'A'), ...end('b', 'B'),
  { key: 'survey_los_confirmed', label: 'Line of sight confirmed by site survey', type: 'boolean', section: 'Survey override', help: 'Waives the MODELLED clearance check only. The link budget is still enforced.' },
  { key: 'survey_note', label: 'Survey note (required if confirmed)', type: 'text', section: 'Survey override' },
  { key: 'notes', label: 'Notes', type: 'text', section: 'Notes' },
];

export const FIELDS_BY_KIND = { site: SITE_FIELDS, sector: SECTOR_FIELDS, link: LINK_FIELDS };

/** Form string -> stored value. Blank -> null (never 0). */
export function coerceFieldValue(field, raw) {
  if (field.type === 'boolean') return raw === true;
  if (raw === '' || raw == null) return null;
  if (field.type === 'number') { const v = Number(raw); return Number.isFinite(v) ? v : null; }
  const t = String(raw).trim();
  return t === '' ? null : t;
}

/** Stored properties -> form values (numbers become strings so blank stays blank). */
export function initialValues(fields, props = {}, defaults = {}) {
  const out = {};
  for (const f of fields) {
    const v = props[f.key] !== undefined ? props[f.key] : defaults[f.key];
    out[f.key] = f.type === 'boolean' ? v === true : v == null ? '' : String(v);
  }
  return out;
}

/** @returns {{ ok:boolean, errors:Record<string,string>, props:Record<string,any> }} */
export function validateFields(fields, values) {
  const errors = {}, props = {};
  for (const f of fields) {
    const v = coerceFieldValue(f, values[f.key]);
    props[f.key] = v;
    if (f.type === 'number') {
      const raw = values[f.key];
      if (raw !== '' && raw != null && v == null) errors[f.key] = 'Enter a number.';
      else if (v == null && f.required) errors[f.key] = 'Required.';
      else if (v != null && f.min != null && v < f.min) errors[f.key] = `Must be at least ${f.min}.`;
      else if (v != null && f.max != null && v > f.max) errors[f.key] = `Must be at most ${f.max}.`;
    }
  }
  if (values.survey_los_confirmed === true && !props.survey_note) errors.survey_note = 'A survey note is required when line of sight is marked as surveyed.';
  return { ok: Object.keys(errors).length === 0, errors, props };
}

/** Radio parameters worth carrying from the previous link so the user is not retyping 10 numbers. */
export const LINK_CARRY_KEYS = ['freq_ghz', 'channel_width_mhz', 'tx_power_a_dbm', 'gain_a_dbi', 'rx_sensitivity_a_dbm', 'cable_loss_a_db',
  'tx_power_b_dbm', 'gain_b_dbi', 'rx_sensitivity_b_dbm', 'cable_loss_b_db', 'extra_loss_db'];
export function carryDefaults(kind, existing) {
  const last = existing?.[existing.length - 1]?.properties;
  if (!last) return {};
  const keys = kind === 'link' ? LINK_CARRY_KEYS
    : kind === 'sector' ? ['freq_ghz', 'tx_power_dbm', 'gain_dbi', 'cable_loss_db', 'beamwidth_deg', 'range_m', 'cpe_height_m', 'cpe_gain_dbi', 'cpe_min_rx_dbm', 'antenna_height_m']
    : ['mast_height_m'];
  return Object.fromEntries(keys.filter(k => last[k] != null).map(k => [k, last[k]]));
}

export const LINK_REQUIRED_KEYS = LINK_REQUIRED.map(r => r[0]);
export const SECTOR_REQUIRED_KEYS = SECTOR_REQUIRED.map(r => r[0]);
