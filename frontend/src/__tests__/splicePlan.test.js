// splicePlan.test.js — Regression suite for splicePlan.js.
//
// WHY THIS EXISTS: splicePlan.js previously had zero test coverage. This
// session both refactored it (extracting shared per-joint rendering logic
// into buildJointSpliceData()/buildLegendsHtml() so generateSplicePlan() and
// the new generateRouteSplicePlan() can share it) and added the new function.
// The refactor's correctness for generateSplicePlan() was verified separately
// by a byte-for-byte comparison against the pre-refactor output across all
// three joint kinds (splitter joint, plain splice joint, CBT) — not repeated
// here as an automated test since it needed the old file as a second module,
// but documented so a future reader knows it was checked, not assumed.
//
// This suite covers generateRouteSplicePlan(): the new function, and the one
// genuinely new piece of logic (chaining traceFibre() through per-joint
// splice data, in path order, filtering out non-splice node types).
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { generateRouteSplicePlan } from '../splicePlan.js';

// A two-splitter cascade (1:4 feeder JNT-1 -> 1:8 terminal JNT-2 -> cabinet),
// matching the same shape used by designHealth.test.js's chainedStore(2) —
// the actual valid Gigaloch-style cascade, not a contrived fixture.
function twoJointRoutedStore() {
  return {
    cabinet: { properties: { pop_id: 'CAB-1' }, geometry: { coordinates: [0, 0] } },
    joints: [
      {
        properties: { joint_id: 'JNT-1', chamber_id: 'CH-1', has_splitter: true, split_ratio: '1:4', joint_type: 'SPLICE' },
        geometry: { coordinates: [0.001, 0.001] },
      },
      {
        properties: { joint_id: 'JNT-2', chamber_id: 'CH-2', has_splitter: true, split_ratio: '1:8', joint_type: 'SPLICE' },
        geometry: { coordinates: [0.002, 0.002] },
      },
    ],
    cbts: [], poles: [],
    cables: [
      { properties: { cable_id: 'CBL-IN', from_node: 'CAB-1', to_node: 'JNT-1', length_m: 100, fibre_count: 12 } },
      { properties: { cable_id: 'CBL-MID', from_node: 'JNT-1', to_node: 'JNT-2', length_m: 50, fibre_count: 12 } },
    ],
    spans: [], cbtTails: [],
    bundles: [{ properties: { uprn: '1000001', bundle_id: 'BUN-1', from_joint: 'JNT-2', length_m: 10 } }],
    aerialDrops: [],
    addressPoints: [{ properties: { uprn: '1000001', address: '1 Test Cottage' } }],
    fibreAssignments: [
      { assign_id: 'ASN-0001', joint_id: 'JNT-1', cable_id: 'CBL-IN', fibre_role: 'SPLITTER_INPUT', tube_number: 1, fibre_number: 1 },
      { assign_id: 'ASN-0002', joint_id: 'JNT-1', splitter_id: 'JNT-1-SP', cable_id: 'JNT-1-SP', bundle_id: 'JNT-2', port: 1, fibre_role: 'SPLITTER_OUTPUT', tube_number: 1, fibre_number: 2 },
      { assign_id: 'ASN-0003', joint_id: 'JNT-2', splitter_id: 'JNT-2-SP', fibre_role: 'SPLITTER_INPUT', tube_number: 1, fibre_number: 1 },
      { assign_id: 'ASN-0004', joint_id: 'JNT-2', splitter_id: 'JNT-2-SP', cable_id: 'JNT-2-SP', bundle_id: 'BUN-1', port: 1, fibre_role: 'SPLITTER_OUTPUT', tube_number: 1, fibre_number: 2 },
    ],
  };
}

describe('generateRouteSplicePlan — HTML escaping (1 Jul audit §3.4)', () => {
  it('escapes a malicious address from CSV import — no raw <script> tag reaches the output document', () => {
    const store = twoJointRoutedStore();
    store.addressPoints[0].properties.address = '<script>alert(1)</script>';
    const result = generateRouteSplicePlan(store, '1000001');
    expect(result.html).not.toContain('<script>alert(1)</script>');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The RAW value is still returned in result.address for the caller to
    // use elsewhere (e.g. a Svelte {address} binding, which auto-escapes
    // its own text content) — only the embedded HTML document itself is
    // escaped. Pre-escaping the returned field too would double-escape
    // wherever it's used outside this module.
    expect(result.address).toBe('<script>alert(1)</script>');
  });

  it('an ampersand in an address renders as a literal & when the document is viewed, not &amp;-of-&amp;', () => {
    const store = twoJointRoutedStore();
    store.addressPoints[0].properties.address = 'Smith & Sons Farm';
    const result = generateRouteSplicePlan(store, '1000001');
    expect(result.html).toContain('Smith &amp; Sons Farm');
    expect(result.html).not.toContain('Smith & Sons Farm');
  });

  it('the actual download filename is NOT escaped even when uprn is unusual — escaping would corrupt it', () => {
    // uprn is normally numeric, but nothing stops a store containing a
    // stray non-numeric one; the filename field must stay exactly usable
    // as a filename regardless, since it's a data value, not HTML text.
    const store = twoJointRoutedStore();
    store.addressPoints[0].properties.uprn = '10&20';
    store.bundles[0].properties.uprn = '10&20';
    const result = generateRouteSplicePlan(store, '10&20');
    expect(result.filename).toBe('route-10&20.html');
  });
});

describe('generateRouteSplicePlan — ROUTED path', () => {
  const store = twoJointRoutedStore();
  const result = generateRouteSplicePlan(store, '1000001');

  it('succeeds (no error) for a complete route', () => {
    expect(result.error).toBeUndefined();
    expect(result.html).toBeTruthy();
  });

  it('lists both joints in path order (nearest-premise first, cabinet-ward last)', () => {
    expect(result.jointIds).toEqual(['JNT-2', 'JNT-1']);
  });

  it('uses the expected filename convention', () => {
    expect(result.filename).toBe('route-1000001.html');
  });

  it('resolves the premise address for the header', () => {
    expect(result.address).toBe('1 Test Cottage');
  });

  it('includes both joint IDs and the premise address somewhere in the document', () => {
    expect(result.html).toContain('JNT-1');
    expect(result.html).toContain('JNT-2');
    expect(result.html).toContain('1 Test Cottage');
  });

  it('is a single well-formed HTML document, not two concatenated documents', () => {
    // Exactly one <!DOCTYPE, one <html>, one </html> — proves the joints were
    // merged into ONE page rather than naively joining two full
    // generateSplicePlan() outputs together.
    expect((result.html.match(/<!DOCTYPE html>/g) || []).length).toBe(1);
    expect((result.html.match(/<\/html>/g) || []).length).toBe(1);
  });
});

describe('generateRouteSplicePlan — incomplete or missing routes', () => {
  it('returns an error for a PARTIAL route (does not export a broken document)', () => {
    const store = twoJointRoutedStore();
    // Break the mid-cable so JNT-2 (and its bundle) is isolated from the cabinet.
    store.cables = store.cables.filter(c => c.properties.cable_id !== 'CBL-MID');
    const result = generateRouteSplicePlan(store, '1000001');
    expect(result.error).toBeTruthy();
    expect(result.html).toBeUndefined();
  });

  it('returns an error for an UNSERVED premise (no bundle at all)', () => {
    const store = twoJointRoutedStore();
    const result = generateRouteSplicePlan(store, '9999999');
    expect(result.error).toBeTruthy();
  });

  it('returns an error, not a throw, when the premise has no cabinet placed', () => {
    const store = { ...twoJointRoutedStore(), cabinet: null };
    expect(() => generateRouteSplicePlan(store, '1000001')).not.toThrow();
    const result = generateRouteSplicePlan(store, '1000001');
    expect(result.error).toBeTruthy();
  });
});

describe('generateRouteSplicePlan — pole exclusion', () => {
  it('excludes POLE nodes from jointIds (structural pass-through, no splice closure)', () => {
    const store = twoJointRoutedStore();
    // Insert a pole between JNT-1 and the cabinet: JNT-1 -> POLE-1 -> CAB-1,
    // replacing the direct JNT-1->CAB-1 cable.
    store.poles = [{ properties: { pole_id: 'POLE-1' }, geometry: { coordinates: [0.0005, 0.0005] } }];
    store.cables = store.cables.filter(c => c.properties.cable_id !== 'CBL-IN');
    store.cables.push(
      { properties: { cable_id: 'CBL-A', from_node: 'JNT-1', to_node: 'POLE-1', length_m: 20, fibre_count: 12 } },
      { properties: { cable_id: 'CBL-B', from_node: 'POLE-1', to_node: 'CAB-1', length_m: 20, fibre_count: 12 } },
    );
    const result = generateRouteSplicePlan(store, '1000001');
    expect(result.error).toBeUndefined();
    expect(result.jointIds).not.toContain('POLE-1');
    expect(result.jointIds).toEqual(['JNT-2', 'JNT-1']);
  });
});
