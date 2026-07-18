// splitterId.test.js — Review 17 Jul 2026, item 5.
// The '-SP' convention was hand-derived in 11 places across 8 files. One helper
// now owns it; this pins the contract those callers depend on.

import { describe, it, expect } from 'vitest';
import { splitterIdFor, isSplitterId, SPLITTER_ID_SUFFIX } from '../splitterId.js';

describe('splitterIdFor', () => {
  it('derives the canonical id for a node', () => {
    expect(splitterIdFor('JNT-001')).toBe('JNT-001-SP');
    expect(splitterIdFor('CBT-014')).toBe('CBT-014-SP');
  });

  it('returns null for a missing node id rather than fabricating a bare suffix', () => {
    // Behaviour change: the old inline `jointId + '-SP'` produced the string
    // 'undefined-SP' for an absent id, which would then be compared against real
    // splitter ids and silently never match. null is honest.
    expect(splitterIdFor(undefined)).toBeNull();
    expect(splitterIdFor(null)).toBeNull();
    expect(splitterIdFor('')).toBeNull();
  });

  it('never yields a bare suffix', () => {
    for (const bad of [undefined, null, '']) expect(splitterIdFor(bad)).not.toBe(SPLITTER_ID_SUFFIX);
  });
});

describe('isSplitterId', () => {
  it('recognises synthetic splitter pigtails', () => {
    expect(isSplitterId('JNT-001-SP')).toBe(true);
    expect(isSplitterId(splitterIdFor('JNT-002'))).toBe(true);
  });

  it('rejects real cable and span ids', () => {
    expect(isSplitterId('CBL-001')).toBe(false);
    expect(isSplitterId('SPAN-004')).toBe(false);
  });

  it('is null/undefined safe (callers pass raw record fields)', () => {
    expect(isSplitterId(undefined)).toBe(false);
    expect(isSplitterId(null)).toBe(false);
    expect(isSplitterId('')).toBe(false);
  });

  it('round-trips with splitterIdFor', () => {
    expect(isSplitterId(splitterIdFor('JNT-001'))).toBe(true);
  });
});
