// mapIds.test.js — Unit tests for the deterministic asset-ID generators
// extracted from mapTools.js into mapIds.js during the decomposition
// (16 Jul 2026). These next*Id() helpers used to read the projectStore
// singleton from deep inside the map module and had no coverage. Here we mock
// projectStore so each generator can be exercised against a controlled set of
// existing assets, pinning the numbering rules (lowest free slot, zero-padding,
// directional base ranges, and the range-exhaustion throw).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable holder the mocked store reads from. vi.hoisted so it exists before
// the hoisted vi.mock factory below runs.
const store = vi.hoisted(() => ({ s: {} }));

vi.mock('../projectStore.js', () => ({
  projectStore: {
    get cabinet()     { return store.s.cabinet ?? null; },
    get chambers()    { return store.s.chambers ?? []; },
    get ducts()       { return store.s.ducts ?? []; },
    get joints()      { return store.s.joints ?? []; },
    get dropDucts()   { return store.s.dropDucts ?? []; },
    get cables()      { return store.s.cables ?? []; },
    get bundles()     { return store.s.bundles ?? []; },
    get poles()       { return store.s.poles ?? []; },
    get cbts()        { return store.s.cbts ?? []; },
    get spans()       { return store.s.spans ?? []; },
    get aerialDrops() { return store.s.aerialDrops ?? []; },
    get cbtTails()    { return store.s.cbtTails ?? []; },
  },
}));

import {
  nextPopId,
  nextChamberId,
  nextPoleId,
  nextCBTId,
  nextSpanId,
  nextAerialDropId,
  nextCBTTailId,
  nextJointId,
  nextDropDuctId,
  nextCableId,
  nextBundleId,
  nextDuctId,
  cbtsWithTail,
  CBT_TAIL_MAX_M,
} from '../mapIds.js';

const pt = (props) => ({ properties: props });

beforeEach(() => { store.s = {}; });

describe('nextPopId (cabinet)', () => {
  it('starts at 001 when no cabinet exists', () => {
    expect(nextPopId('SCOT')).toBe('SCOT-CAB-001');
  });

  it('skips the number already used by the existing cabinet', () => {
    store.s.cabinet = pt({ pop_id: 'SCOT-CAB-001' });
    expect(nextPopId('SCOT')).toBe('SCOT-CAB-002');
  });
});

describe('directional generators (chamber / duct)', () => {
  it('nextChamberId uses the direction base and returns id + seq', () => {
    expect(nextChamberId('A', 'N')).toEqual({ id: 'A-CMBR-0001', seq: 1 });
    expect(nextChamberId('A', 'S')).toEqual({ id: 'A-CMBR-1001', seq: 1001 });
  });

  it('nextChamberId fills the lowest free seq within the direction range', () => {
    store.s.chambers = [pt({ chamber_seq: 1 }), pt({ chamber_seq: 2 })];
    expect(nextChamberId('A', 'N')).toEqual({ id: 'A-CMBR-0003', seq: 3 });
  });

  it('nextDuctId mirrors the same directional scheme (3-digit pad)', () => {
    expect(nextDuctId('A', 'N')).toEqual({ id: 'A-DUCT-001', seq: 1 });
    expect(nextDuctId('A', 'E')).toEqual({ id: 'A-DUCT-200', seq: 200 });
  });

  it('nextDuctId throws when the direction range is exhausted', () => {
    // N range is 1..99. Fill it completely.
    store.s.ducts = Array.from({ length: 99 }, (_, i) => pt({ duct_seq: i + 1 }));
    expect(() => nextDuctId('A', 'N')).toThrow(/No available duct numbers/);
  });
});

describe('sequential 3-digit generators', () => {
  const cases = [
    ['pole',   nextPoleId,       'poles',       'pole_id',  'A-POL-'],
    ['cbt',    nextCBTId,        'cbts',        'cbt_id',   'A-CBT-'],
    ['span',   nextSpanId,       'spans',       'span_id',  'A-SPAN-'],
    ['adrop',  nextAerialDropId, 'aerialDrops', 'adrop_id', 'A-ADROP-'],
    ['tail',   nextCBTTailId,    'cbtTails',    'tail_id',  'A-TAIL-'],
    ['joint',  nextJointId,      'joints',      'joint_id', 'A-JNT-'],
    ['ddct',   nextDropDuctId,   'dropDucts',   'ddct_id',  'A-DDCT-'],
    ['cable',  nextCableId,      'cables',      'cable_id', 'A-CBL-'],
    ['bundle', nextBundleId,     'bundles',     'bundle_id','A-BDL-'],
  ];

  it.each(cases)('nextId for %s starts at 001 when empty', (_name, fn, _coll, _key, prefix) => {
    expect(fn('A')).toBe(`${prefix}001`);
  });

  it.each(cases)('nextId for %s fills the first gap in the sequence', (_name, fn, coll, key, prefix) => {
    store.s[coll] = [pt({ [key]: `${prefix}001` }), pt({ [key]: `${prefix}003` })];
    expect(fn('A')).toBe(`${prefix}002`);
  });
});

describe('cbtsWithTail / CBT_TAIL_MAX_M', () => {
  it('collects the set of CBT ids that already own a tail', () => {
    store.s.cbtTails = [
      pt({ from_cbt: 'A-CBT-001' }),
      pt({ from_cbt: 'A-CBT-004' }),
      pt({ from_cbt: undefined }), // ignored
    ];
    const set = cbtsWithTail();
    expect(set.has('A-CBT-001')).toBe(true);
    expect(set.has('A-CBT-004')).toBe(true);
    expect(set.has('A-CBT-002')).toBe(false);
    expect(set.size).toBe(2);
  });

  it('exposes the 350 m ceiling constant', () => {
    expect(CBT_TAIL_MAX_M).toBe(350);
  });
});
