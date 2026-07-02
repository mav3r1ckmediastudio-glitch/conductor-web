// optical.test.js — Regression suite for the optical power budget calculator.
//
// This engine is already exercised indirectly through fibreTrace.test.js (one
// ROUTED scenario runs the real budget calc end-to-end), but it deserves its
// own direct suite: it's one of the four engines the audit named specifically
// (trace/assign/optical/bom), and a pass/fail optical verdict is exactly the
// kind of number a customer or build team acts on directly — "is this premise
// servable" shouldn't depend on an untested formula.
//
// As with the other suites, every expected number below was worked out by
// hand against optical.js's actual constants and formulae (lines 9-21, 33-90)
// before running anything.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OPTICAL, DEFAULT_SPLITTER_LOSS_DB, LINK_CLASS_BUDGET_DB,
  defaultOptical, splitterLossForRatio, linkBudgetDb, calculateRouteBudget,
} from '../optical.js';

describe('splitterLossForRatio — known ratios from the lookup table', () => {
  it('returns the exact table value for each standard split ratio', () => {
    expect(splitterLossForRatio('1:2',  DEFAULT_SPLITTER_LOSS_DB)).toBe(3.5);
    expect(splitterLossForRatio('1:4',  DEFAULT_SPLITTER_LOSS_DB)).toBe(7.0);
    expect(splitterLossForRatio('1:8',  DEFAULT_SPLITTER_LOSS_DB)).toBe(10.5);
    expect(splitterLossForRatio('1:16', DEFAULT_SPLITTER_LOSS_DB)).toBe(14.0);
    expect(splitterLossForRatio('1:32', DEFAULT_SPLITTER_LOSS_DB)).toBe(17.5);
  });

  it('tolerates surrounding whitespace in the ratio string', () => {
    expect(splitterLossForRatio(' 1:8 ', DEFAULT_SPLITTER_LOSS_DB)).toBe(10.5);
  });
});

describe('splitterLossForRatio — fallback formula for ratios not in the table', () => {
  it('uses 10·log10(N) + 1.5dB for a ratio outside the standard table (1:64)', () => {
    // 10 * log10(64) + 1.5 = 10 * 1.806179974... + 1.5 = 19.56179974...
    const result = splitterLossForRatio('1:64', DEFAULT_SPLITTER_LOSS_DB);
    expect(result).toBeCloseTo(19.5618, 3);
  });
});

describe('splitterLossForRatio — edge cases', () => {
  it('returns 0 for a null or empty ratio', () => {
    expect(splitterLossForRatio(null, DEFAULT_SPLITTER_LOSS_DB)).toBe(0.0);
    expect(splitterLossForRatio('',   DEFAULT_SPLITTER_LOSS_DB)).toBe(0.0);
  });

  it('returns 0 for a string that does not match the 1:N pattern at all', () => {
    expect(splitterLossForRatio('garbage', DEFAULT_SPLITTER_LOSS_DB)).toBe(0.0);
  });
});

describe('linkBudgetDb — link class budgets after safety margin', () => {
  it('B+ class: 28.0dB budget minus 3.0dB safety margin = 25.0dB', () => {
    expect(linkBudgetDb({ link_class: 'B+', safety_margin_db: 3.0 })).toBe(25.0);
  });

  it('C+ class: 32.0dB budget minus 3.0dB safety margin = 29.0dB', () => {
    expect(linkBudgetDb({ link_class: 'C+', safety_margin_db: 3.0 })).toBe(29.0);
  });

  it('falls back to B+ for an unrecognised link class rather than erroring', () => {
    expect(linkBudgetDb({ link_class: 'UNKNOWN', safety_margin_db: 3.0 })).toBe(25.0);
  });

  it('falls back to the default 3.0dB safety margin when none is supplied', () => {
    expect(linkBudgetDb({ link_class: 'B+' })).toBe(25.0);
  });

  it('respects a custom, non-default safety margin', () => {
    expect(linkBudgetDb({ link_class: 'B+', safety_margin_db: 5.0 })).toBe(23.0);
  });
});

describe('calculateRouteBudget — straightforward passing route', () => {
  // fibreLengthM=80, spliceCount=0, no splitters, default optical settings.
  //   fibre_db     = (80/1000) * 0.25 = 0.02
  //   splice_db    = 0
  //   splitter_db  = 0
  //   connector_db = 1.5 (fixed default)
  //   loss_db      = 0.02 + 0 + 0 + 1.5 = 1.52
  //   budget_db    = 29.0 (C+ default, Gigaloch's standard — 32.0 - 3.0 safety margin)
  //   margin_db    = 29.0 - 1.52 = 27.48
  it('produces the exact hand-calculated figures for a short, splitter-free run', () => {
    const result = calculateRouteBudget(80, 0, [], defaultOptical());
    expect(result.loss_db).toBe(1.52);
    expect(result.budget_db).toBe(29.0);
    expect(result.margin_db).toBe(27.48);
    expect(result.link_pass).toBe(true);
  });

  it('defaults to defaultOptical() settings when optical is null', () => {
    const result = calculateRouteBudget(80, 0, [], null);
    expect(result.budget_db).toBe(29.0);
  });
});

describe('calculateRouteBudget — multiple splitters in cascade', () => {
  // fibreLengthM=1000, spliceCount=2, splitters=['1:4','1:8'], default optical.
  //   fibre_db     = (1000/1000) * 0.25 = 0.25
  //   splice_db    = 2 * 0.10 = 0.20
  //   splitter_db  = 7.0 (1:4) + 10.5 (1:8) = 17.5
  //   connector_db = 1.5
  //   loss_db      = 0.25 + 0.20 + 17.5 + 1.5 = 19.45
  //   margin_db    = 29.0 (C+ default) - 19.45 = 9.55
  it('sums splitter losses across a 1:4 → 1:8 cascade correctly', () => {
    const result = calculateRouteBudget(1000, 2, ['1:4', '1:8'], defaultOptical());
    expect(result.loss_db).toBe(19.45);
    expect(result.margin_db).toBe(9.55);
    expect(result.link_pass).toBe(true);
    expect(result.breakdown.splitter_db).toBe(17.5);
    expect(result.breakdown.splitters).toEqual(['1:4', '1:8']);
  });
});

describe('calculateRouteBudget — a route that genuinely fails the budget', () => {
  // fibreLengthM=40000 (40km), spliceCount=5, splitters=['1:32'], default optical.
  // (25km was the original scenario under the old B+ default's 25.0dB budget;
  // lengthened to 40km so this still genuinely fails now that the default is
  // C+'s wider 29.0dB — a shorter route wasn't over budget any more.)
  //   fibre_db     = (40000/1000) * 0.25 = 10.0
  //   splice_db    = 5 * 0.10 = 0.50
  //   splitter_db  = 17.5
  //   connector_db = 1.5
  //   loss_db      = 10.0 + 0.50 + 17.5 + 1.5 = 29.5
  //   margin_db    = 29.0 - 29.5 = -0.5  →  NEGATIVE, link_pass must be false
  it('correctly fails an over-budget long-haul route with a 1:32 splitter', () => {
    const result = calculateRouteBudget(40000, 5, ['1:32'], defaultOptical());
    expect(result.loss_db).toBe(29.5);
    expect(result.margin_db).toBe(-0.5);
    expect(result.link_pass).toBe(false);
  });
});

describe('calculateRouteBudget — breakdown completeness', () => {
  it('reports the raw (unrounded) input length and counts in the breakdown', () => {
    const result = calculateRouteBudget(215, 1, ['1:8'], defaultOptical());
    expect(result.breakdown.fibre_length_m).toBe(215);
    expect(result.breakdown.splice_count).toBe(1);
  });
});

describe('calculateRouteBudget — respects custom optical settings, not just defaults', () => {
  it('a tighter safety margin reduces the usable budget and can flip the verdict', () => {
    const tightMargin = { ...defaultOptical(), safety_margin_db: 10.0 };
    // Same route as the "straightforward passing" case above, but budget_db
    // drops from 29.0 to 22.0 (32.0 - 10.0). loss_db is still 1.52, so it
    // still passes here — proving the override is applied, not ignored.
    const result = calculateRouteBudget(80, 0, [], tightMargin);
    expect(result.budget_db).toBe(22.0);
    expect(result.margin_db).toBe(20.48);
  });
});
