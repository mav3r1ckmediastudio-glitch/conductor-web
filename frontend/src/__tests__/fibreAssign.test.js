// fibreAssign.test.js — Regression suite for stickyAllocate(), the sticky,
// freeze-aware splitter port allocator.
//
// WHY THIS ONE FIRST: assignFibres(store) is the full cascade pipeline and needs
// a whole network graph fixture (cabinet, joints, CBTs, cables, spans) to
// exercise meaningfully — that's a bigger follow-up task. stickyAllocate() is
// the actual port-assignment logic underneath it: pure, fully self-contained
// (just an array of consumers + a port cap, no store/graph needed), and it's the
// piece the audit specifically called "non-trivial and well-executed." High
// value, low setup cost — the right place to start.
//
// Every expected result below was worked out by hand by reading the function's
// actual logic (see fibreAssign.js lines 62-100), not by running it first and
// copying the output.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { stickyAllocate } from '../fibreAssign.js';

describe('stickyAllocate — fresh allocation, no stored ports', () => {
  it('fills the lowest free ports in sortKey order, regardless of input order', () => {
    const consumers = [
      { asset: 'D', sortKey: 'D', port: null, status: 'PROPOSED' },
      { asset: 'B', sortKey: 'B', port: null, status: 'PROPOSED' },
      { asset: 'C', sortKey: 'C', port: null, status: 'PROPOSED' },
      { asset: 'A', sortKey: 'A', port: null, status: 'PROPOSED' },
    ];
    const result = stickyAllocate(consumers, 4);
    expect(result.portOf).toEqual({ A: 1, B: 2, C: 3, D: 4 });
    expect(result.flags).toEqual([]);
  });
});

describe('stickyAllocate — stored ports are honoured', () => {
  it('keeps a consumer on its previously-stored port and fills the rest around it', () => {
    const consumers = [
      { asset: 'X', sortKey: 'X', port: 2, status: 'PROPOSED' },
      { asset: 'Y', sortKey: 'Y', port: null, status: 'PROPOSED' },
    ];
    // X is pinned to port 2 (stored). Y has no stored port (fresh) and takes
    // the lowest free port, which is 1 (since 2 is taken).
    const result = stickyAllocate(consumers, 4);
    expect(result.portOf).toEqual({ X: 2, Y: 1 });
    expect(result.flags).toEqual([]);
  });
});

describe('stickyAllocate — port collision (two consumers stored on the same port)', () => {
  it('the frozen (INSTALLED/LIVE) consumer wins the contested port', () => {
    const consumers = [
      { asset: 'proposed-loser', sortKey: 'A', port: 3, status: 'PROPOSED' },
      { asset: 'live-winner',    sortKey: 'B', port: 3, status: 'LIVE' },
    ];
    const result = stickyAllocate(consumers, 4);
    expect(result.portOf['live-winner']).toBe(3);
  });

  it('IMPORTANT: the collision loser is left completely unassigned, not bumped to a free port', () => {
    // This is a real, non-obvious behaviour worth pinning down with a test:
    // because both consumers had a port value in-range, BOTH go into the
    // "stored" bucket, not "fresh" — so the loser never gets a fallback port
    // from the free-port fill pass. It needs a human (or the UI) to clear its
    // stored port before it'll be picked up again next run.
    const consumers = [
      { asset: 'proposed-loser', sortKey: 'A', port: 3, status: 'PROPOSED' },
      { asset: 'live-winner',    sortKey: 'B', port: 3, status: 'LIVE' },
    ];
    const result = stickyAllocate(consumers, 4);
    expect(result.portOf['proposed-loser']).toBeUndefined();
    expect(result.flags).toEqual([
      'COLLISION port 3: live-winner vs proposed-loser',
    ]);
  });
});

describe('stickyAllocate — overcap (more consumers than ports)', () => {
  it('assigns what it can and flags the rest as OVERCAP, leaving them unassigned', () => {
    const consumers = [
      { asset: 'A', sortKey: 'A', port: null, status: 'PROPOSED' },
      { asset: 'B', sortKey: 'B', port: null, status: 'PROPOSED' },
      { asset: 'C', sortKey: 'C', port: null, status: 'PROPOSED' },
    ];
    const result = stickyAllocate(consumers, 2); // only 2 ports for 3 consumers
    expect(result.portOf).toEqual({ A: 1, B: 2 });
    expect(result.portOf.C).toBeUndefined();
    expect(result.flags).toEqual([
      'OVERCAP: C (no free port within cap 2)',
    ]);
  });
});

describe('stickyAllocate — frozen consumer that cannot be placed', () => {
  it('flags BOTH overcap and frozen-unplaced when a frozen device loses out on a full splitter', () => {
    // cap=1, two fresh (no stored port) consumers. Sort order puts G before F,
    // so G claims the only port and F — despite being INSTALLED — gets bumped.
    // Because F never gets a port, it triggers two separate flags: OVERCAP from
    // the fill pass, then FROZEN_UNPLACED from the final frozen-status sweep.
    const consumers = [
      { asset: 'F', sortKey: 'B', port: null, status: 'INSTALLED' },
      { asset: 'G', sortKey: 'A', port: null, status: 'PROPOSED' },
    ];
    const result = stickyAllocate(consumers, 1);
    expect(result.portOf).toEqual({ G: 1 });
    expect(result.portOf.F).toBeUndefined();
    expect(result.flags).toEqual([
      'OVERCAP: F (no free port within cap 1)',
      'FROZEN_UNPLACED: F (status=INSTALLED)',
    ]);
  });

  it('does NOT flag frozen-unplaced when the frozen consumer does get a port via the fresh-fill pass', () => {
    const consumers = [
      { asset: 'F', sortKey: 'A', port: null, status: 'INSTALLED' },
    ];
    const result = stickyAllocate(consumers, 4);
    expect(result.portOf).toEqual({ F: 1 });
    expect(result.flags).toEqual([]);
  });
});

describe('stickyAllocate — empty input', () => {
  it('returns clean empty results for zero consumers', () => {
    const result = stickyAllocate([], 8);
    expect(result.occupied).toEqual({});
    expect(result.portOf).toEqual({});
    expect(result.flags).toEqual([]);
  });
});
