// mapSearch.test.js — Regression suite for the pure matching/bounds half of
// mapSearch.js, extracted from App.svelte in the 16 Jul 2026 refactor.
//
// WHY THIS EXISTS: this logic previously lived inline in App.svelte where
// nothing could unit-test it. The extraction's contract is "behaviour
// unchanged" — these tests pin the behaviour that matters so future edits
// to search/bounds can't silently drift: postcode matching is space/case-
// insensitive, exact asset-ID matches beat starts-with matches across ALL
// collections, and projectBounds walks every geometry type.
//
// The map-facing wrappers (searchAndZoom / fitToProject) are deliberately
// NOT covered here — they're thin camera/marker/toast glue over these pure
// functions, and exercising them properly needs a real map (E2E territory).
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { matchPostcode, matchAsset, featureCenter, projectBounds, UK_POSTCODE_RE } from '../mapSearch.js';

const pt = (lng, lat) => ({ type: 'Point', coordinates: [lng, lat] });

function makeState() {
  return {
    addressPoints: [
      { properties: { uprn: '1000001', postcode: 'FK20 8RU' }, geometry: pt(-4.71, 56.44) },
      { properties: { uprn: '1000002', postcode: 'FK20 8RU' }, geometry: pt(-4.72, 56.45) },
      { properties: { uprn: '2000001', postcode: 'G1 1AA' },   geometry: pt(-4.25, 55.86) },
    ],
    chambers: [
      { properties: { chamber_id: 'SCOT-PH1-CMBR-0001' }, geometry: pt(-4.70, 56.43) },
    ],
    cables: [
      { properties: { cable_id: 'SCOT-PH1-CBL-001' },
        geometry: { type: 'LineString', coordinates: [[-4.70, 56.43], [-4.705, 56.435], [-4.71, 56.44]] } },
    ],
    joints: [
      { properties: { joint_id: 'SCOT-PH1-JNT-001' }, geometry: pt(-4.705, 56.435) },
    ],
  };
}

describe('mapSearch — matchPostcode', () => {
  it('matches a postcode regardless of spacing and case', () => {
    const state = makeState();
    expect(matchPostcode(state, 'fk208ru')).toHaveLength(2);
    expect(matchPostcode(state, 'FK20 8RU')).toHaveLength(2);
    expect(matchPostcode(state, 'fk20 8ru')).toHaveLength(2);
  });

  it('returns empty for a postcode not in the project', () => {
    expect(matchPostcode(makeState(), 'EH1 1AA')).toHaveLength(0);
  });

  it('does not partial-match postcodes (FK20 must not match FK2)', () => {
    expect(matchPostcode(makeState(), 'FK2')).toHaveLength(0);
  });
});

describe('mapSearch — matchAsset', () => {
  it('finds an exact asset ID, case-insensitively, with the right label', () => {
    const found = matchAsset(makeState(), 'scot-ph1-jnt-001');
    expect(found).not.toBe(null);
    expect(found.label).toBe('Joint');
    expect(found.feature.properties.joint_id).toBe('SCOT-PH1-JNT-001');
  });

  it('falls back to starts-with when no exact match exists', () => {
    const found = matchAsset(makeState(), 'SCOT-PH1-CMBR');
    expect(found.label).toBe('Chamber');
  });

  it('an exact match in a LATER collection beats a starts-with match in an EARLIER one', () => {
    // 'SCOT-PH1-JNT-001' is exact on joints; chambers/cables only prefix-match
    // 'SCOT-PH1'. The two-pass order guarantees exact-anywhere wins first.
    const state = makeState();
    state.chambers[0].properties.chamber_id = 'SCOT-PH1-JNT-0010'; // starts-with trap in an earlier collection
    const found = matchAsset(state, 'SCOT-PH1-JNT-001');
    expect(found.label).toBe('Joint');
  });

  it('returns null when nothing matches', () => {
    expect(matchAsset(makeState(), 'NOPE-999')).toBe(null);
  });

  it('matches a premise by UPRN', () => {
    const found = matchAsset(makeState(), '1000002');
    expect(found.label).toBe('Premise');
  });
});

describe('mapSearch — featureCenter', () => {
  it('returns point coordinates directly', () => {
    expect(featureCenter({ geometry: pt(-4.7, 56.4) })).toEqual([-4.7, 56.4]);
  });

  it('returns the midpoint vertex of a LineString', () => {
    const state = makeState();
    expect(featureCenter(state.cables[0])).toEqual([-4.705, 56.435]);
  });

  it('returns null for missing/unsupported geometry', () => {
    expect(featureCenter({})).toBe(null);
    expect(featureCenter({ geometry: { type: 'Polygon', coordinates: [] } })).toBe(null);
  });
});

describe('mapSearch — projectBounds', () => {
  it('returns null for an empty project', () => {
    expect(projectBounds({})).toBe(null);
  });

  it('bounds cover every collection, not just cabinet/build area', () => {
    const b = projectBounds(makeState());
    const [[minLng, minLat], [maxLng, maxLat]] = b;
    expect(minLng).toBeCloseTo(-4.72);
    expect(maxLng).toBeCloseTo(-4.25);
    expect(minLat).toBeCloseTo(55.86);
    expect(maxLat).toBeCloseTo(56.45);
  });

  it('includes cabinet and buildArea polygon geometry', () => {
    const state = {
      cabinet: { geometry: pt(-5.0, 57.0) },
      buildArea: { geometry: { type: 'Polygon', coordinates: [[[-5.1, 56.9], [-4.9, 56.9], [-4.9, 57.1], [-5.1, 57.1], [-5.1, 56.9]]] } },
    };
    const [[minLng, minLat], [maxLng, maxLat]] = projectBounds(state);
    expect(minLng).toBeCloseTo(-5.1);
    expect(maxLng).toBeCloseTo(-4.9);
    expect(minLat).toBeCloseTo(56.9);
    expect(maxLat).toBeCloseTo(57.1);
  });

  it('handles LineString geometry in bounds', () => {
    const state = { cables: [{ properties: {}, geometry: { type: 'LineString', coordinates: [[-1, 50], [-2, 51]] } }] };
    const [[minLng, minLat], [maxLng, maxLat]] = projectBounds(state);
    expect(minLng).toBe(-2);
    expect(maxLng).toBe(-1);
    expect(minLat).toBe(50);
    expect(maxLat).toBe(51);
  });
});

describe('mapSearch — UK_POSTCODE_RE gate', () => {
  it('accepts realistic postcode shapes (spaces pre-stripped)', () => {
    for (const pc of ['FK208RU', 'G11AA', 'EH11AA', 'SW1A1AA']) {
      expect(UK_POSTCODE_RE.test(pc)).toBe(true);
    }
  });
  it('rejects asset-ID shapes so a typo never costs a network round-trip', () => {
    for (const q of ['SCOT-PH1-JNT-001', 'CMBR', '12345', 'HELLO']) {
      expect(UK_POSTCODE_RE.test(q)).toBe(false);
    }
  });
});
