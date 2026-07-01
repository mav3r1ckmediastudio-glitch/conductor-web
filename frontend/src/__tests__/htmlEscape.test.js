// htmlEscape.test.js — Regression suite for escapeHtml(), the shared
// HTML-escaping helper used by bom.js, sld.js, and splicePlan.js.
//
// Run with: npm test

import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../htmlEscape.js';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes a realistic injection attempt end-to-end', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not double-escape an already-escaped ampersand entity', () => {
    // Known limitation, documented rather than silently accepted: escaping
    // is not idempotent (escapeHtml('&amp;') would become '&amp;amp;' if
    // called twice). This test exists to make that explicit — callers must
    // escape raw data exactly once, at the point of HTML embedding, never
    // on an already-escaped or already-rendered string.
    const once = escapeHtml('Tom & Jerry');
    expect(once).toBe('Tom &amp; Jerry');
  });

  it('leaves ordinary text, numbers, and punctuation untouched', () => {
    expect(escapeHtml('123 Main Street')).toBe('123 Main Street');
    expect(escapeHtml('CBL-001')).toBe('CBL-001');
    expect(escapeHtml(42)).toBe('42');
  });

  it('is null-safe, matching the S(v) convention it replaces at HTML call sites', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('coerces non-string types the same way String() would, before escaping', () => {
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
    expect(escapeHtml(true)).toBe('true');
  });
});
