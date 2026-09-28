import { describe, it, expect } from 'vitest';
import { FIELDS_BY_KIND, LINK_FIELDS, SECTOR_FIELDS, SITE_FIELDS, coerceFieldValue, validateFields, initialValues, carryDefaults, LINK_REQUIRED_KEYS, SECTOR_REQUIRED_KEYS } from '../wirelessFields.js';

const reqKeys = (fields) => fields.filter(f => f.required).map(f => f.key).sort();

describe('field specs agree with the analysis rules (single source of truth)', () => {
  it('link and sector required fields match exactly', () => {
    expect(reqKeys(LINK_FIELDS)).toEqual([...LINK_REQUIRED_KEYS].sort());
    expect(reqKeys(SECTOR_FIELDS)).toEqual([...SECTOR_REQUIRED_KEYS].sort());
  });
  it('a site requires a mast height', () => { expect(reqKeys(SITE_FIELDS)).toEqual(['mast_height_m']); });
  it('every field has a unique key per kind', () => {
    for (const f of Object.values(FIELDS_BY_KIND)) expect(new Set(f.map(x => x.key)).size).toBe(f.length);
  });
});

describe('coercion & validation', () => {
  const num = { key: 'x', type: 'number' };
  it('blank is null, never 0; numbers parse; junk is null', () => {
    expect(coerceFieldValue(num, '')).toBeNull();
    expect(coerceFieldValue(num, '0')).toBe(0);
    expect(coerceFieldValue(num, '12.5')).toBe(12.5);
    expect(coerceFieldValue(num, 'abc')).toBeNull();
    expect(coerceFieldValue({ type: 'text' }, '  hi ')).toBe('hi');
    expect(coerceFieldValue({ type: 'text' }, '   ')).toBeNull();
  });
  it('reports required, non-numeric and out-of-range values', () => {
    const v = validateFields(SITE_FIELDS, { name: '', mast_height_m: '', ground_override_m: 'abc', notes: '' });
    expect(v.ok).toBe(false);
    expect(v.errors.mast_height_m).toBe('Required.');
    expect(v.errors.ground_override_m).toBe('Enter a number.');
    expect(validateFields(SITE_FIELDS, { mast_height_m: '-1' }).errors.mast_height_m).toMatch(/at least/);
    expect(validateFields(SECTOR_FIELDS, { ...Object.fromEntries(SECTOR_FIELDS.map(f => [f.key, '10'])), azimuth_deg: '400' }).errors.azimuth_deg).toMatch(/at most/);
    expect(validateFields(SITE_FIELDS, { mast_height_m: '25' }).ok).toBe(true);
  });
  it('a surveyed-LOS claim needs a note', () => {
    const all = Object.fromEntries(LINK_FIELDS.map(f => [f.key, f.type === 'boolean' ? false : '10']));
    expect(validateFields(LINK_FIELDS, { ...all, survey_los_confirmed: true, survey_note: '' }).errors.survey_note).toBeDefined();
    expect(validateFields(LINK_FIELDS, { ...all, survey_los_confirmed: true, survey_note: 'walked it' }).ok).toBe(true);
  });
  it('round-trips existing properties into form strings and back', () => {
    const iv = initialValues(SITE_FIELDS, { mast_height_m: 30, ground_override_m: null });
    expect(iv.mast_height_m).toBe('30'); expect(iv.ground_override_m).toBe('');
    expect(validateFields(SITE_FIELDS, iv).props.mast_height_m).toBe(30);
  });
  it('carries radio parameters (not ids or survey overrides) from the previous item', () => {
    const d = carryDefaults('link', [{ properties: { link_id: 'L1', freq_ghz: 5, tx_power_a_dbm: 25, survey_los_confirmed: true, survey_note: 'x' } }]);
    expect(d).toMatchObject({ freq_ghz: 5, tx_power_a_dbm: 25 });
    expect(d).not.toHaveProperty('link_id');
    expect(d).not.toHaveProperty('survey_los_confirmed');
    expect(d).not.toHaveProperty('survey_note');
    // A first link starts from the gigabit backhaul preset (was: blank).
    expect(carryDefaults('link', [])).toMatchObject({ freq_ghz: 11, gain_a_dbi: 38 });
  });
});
