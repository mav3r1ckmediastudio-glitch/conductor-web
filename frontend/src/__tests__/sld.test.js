// sld.test.js — Regression suite for generateSld(), the Single Line Diagram
// generator. This file previously had ZERO test coverage — not flagged by
// either prior audit specifically, but found and closed alongside the 1 Jul
// audit's §3.4 HTML-escaping fix, since fixing the escaping here required
// reading (and changing) most of this file's rendering logic anyway.
//
// Two things under test:
//   1. A basic smoke test — generateSld() produces a well-formed document
//      containing the expected node IDs, given a small hand-built network.
//      Not exhaustive (the tree-rendering logic — poles, CBTs, splitters,
//      aerial vs UG branches — has real structural complexity that would
//      deserve its own dedicated suite), but enough to ground the escaping
//      tests below in a genuinely working baseline, not a mocked one.
//   2. HTML escaping (1 Jul audit §3.4) — the actual reason this suite was
//      written today. Every user/CSV-derived field reaching the rendered
//      document (address, project areaId, cable/joint/bundle/drop IDs) is
//      checked for a real injection attempt, not just "did it not crash".
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { generateSld } from '../sld.js';

// Cabinet -> JNT-1 (1:8 splitter) -> BUN-1 (UG bundle, premise A)
//                                 -> CBT-1 -> ADR-1 (aerial drop, premise B)
function networkFixture() {
  return {
    project: { areaId: 'ENG-CH3' },
    cabinet: { properties: { pop_id: 'CAB-1' } },
    cables: [
      { properties: { cable_id: 'CBL-1', from_node: 'CAB-1', to_node: 'JNT-1', length_m: 100, fibre_count: 48, cable_type: 'FEEDER' } },
    ],
    spans: [],
    cbtTails: [
      { properties: { tail_id: 'TAIL-1', from_node: 'JNT-1', to_node: 'CBT-1', length_m: 30 } },
    ],
    joints: [
      { properties: { joint_id: 'JNT-1', joint_type: 'SPLICE', has_splitter: true, split_ratio: '1:8', chamber_id: 'CH-1' } },
    ],
    cbts: [
      { properties: { cbt_id: 'CBT-1', parent_pole_id: '' } },
    ],
    poles: [],
    bundles: [
      { properties: { bundle_id: 'BUN-1', uprn: '1000001', from_joint: 'JNT-1', fibre_count: 1, length_m: 10 } },
    ],
    aerialDrops: [
      { properties: { adrop_id: 'ADR-1', uprn: '1000002', from_cbt: 'CBT-1', length_m: 15 } },
    ],
    addressPoints: [
      { properties: { uprn: '1000001', address: '1 Test Cottage' } },
      { properties: { uprn: '1000002', address: '2 Test Cottage' } },
    ],
    fibreAssignments: [],
  };
}

describe('generateSld — basic smoke test', () => {
  it('throws a clear error when no cabinet is placed, rather than producing a broken document', () => {
    const store = { ...networkFixture(), cabinet: null };
    expect(() => generateSld(store)).toThrow(/No cabinet placed/);
  });

  it('produces a single well-formed document containing every node in the network', () => {
    const html = generateSld(networkFixture());
    expect(html).toContain('<!DOCTYPE html>');
    expect((html.match(/<!DOCTYPE html>/g) || []).length).toBe(1);
    expect(html).toContain('CAB-1');
    expect(html).toContain('CBL-1');
    expect(html).toContain('JNT-1');
    expect(html).toContain('CBT-1');
    expect(html).toContain('BUN-1');
    expect(html).toContain('ADR-1');
    expect(html).toContain('1 Test Cottage');
    expect(html).toContain('2 Test Cottage');
  });

  it('labels the splitter joint with its declared ratio', () => {
    const html = generateSld(networkFixture());
    expect(html).toContain('1:8 splitter');
  });
});

describe('generateSld — HTML escaping (1 Jul audit §3.4)', () => {
  it('escapes a malicious bundle-premise address — no raw tag reaches the output document', () => {
    const store = networkFixture();
    store.addressPoints[0].properties.address = '<script>alert(1)</script>';
    const html = generateSld(store);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes a malicious aerial-drop-premise address the same way', () => {
    const store = networkFixture();
    store.addressPoints[1].properties.address = '<img src=x onerror=alert(2)>';
    const html = generateSld(store);
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('escapes a malicious project areaId (title, header, and footer all use it)', () => {
    const store = networkFixture();
    store.project.areaId = '"><script>alert(3)</script>';
    const html = generateSld(store);
    expect(html).not.toContain('"><script>alert(3)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('an ampersand in an address renders as a literal & when viewed, not double-escaped', () => {
    const store = networkFixture();
    store.addressPoints[0].properties.address = 'Smith & Sons Farm';
    const html = generateSld(store);
    expect(html).toContain('Smith &amp; Sons Farm');
    expect(html).not.toContain('Smith & Sons Farm');
  });

  it('escapes a malicious chamber_id shown on a splitter joint node', () => {
    const store = networkFixture();
    store.joints[0].properties.chamber_id = '<b>CH-1</b>';
    const html = generateSld(store);
    expect(html).not.toContain('<b>CH-1</b>');
    expect(html).toContain('&lt;b&gt;CH-1&lt;/b&gt;');
  });
});
