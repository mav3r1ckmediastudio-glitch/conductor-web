// Typical (assumed) canopy height per NFI stand type. These are planning
// estimates, not measurements — the tests only check the lookup table is
// applied consistently, not that any figure is "correct" for a real tree.
import { describe, it, expect } from 'vitest';
import { typicalCanopy, IFT_GROUP, GROUP_HEIGHT_M } from '../forestryHeights.js';

describe('typicalCanopy', () => {
  it('groups conifer variants together, taller than broadleaved', () => {
    expect(typicalCanopy('Conifer').group).toBe('Conifer');
    expect(typicalCanopy('Mixed mainly conifer').group).toBe('Conifer');
    expect(typicalCanopy('Broadleaved').group).toBe('Broadleaved');
    expect(typicalCanopy('Mixed mainly broadleaved').group).toBe('Broadleaved');
    expect(typicalCanopy('Conifer').heightM).toBeGreaterThan(typicalCanopy('Broadleaved').heightM);
  });
  it('coppice groups as broadleaved', () => {
    expect(typicalCanopy('Coppice').group).toBe('Broadleaved');
    expect(typicalCanopy('Coppice with standards').group).toBe('Broadleaved');
  });
  it('cleared/disturbed ground has zero canopy height regardless of CATEGORY', () => {
    for (const v of ['Felled', 'Windblow', 'Ground prep', 'Failed']) {
      expect(typicalCanopy(v).group).toBe('Cleared');
      expect(typicalCanopy(v).heightM).toBe(0);
    }
  });
  it('young trees are shorter than a mature stand of either main type', () => {
    const yt = typicalCanopy('Young trees').heightM;
    expect(yt).toBeGreaterThan(0);
    expect(yt).toBeLessThan(typicalCanopy('Broadleaved').heightM);
    expect(yt).toBeLessThan(typicalCanopy('Conifer').heightM);
  });
  it('non-woodland CATEGORY always yields zero height, whatever IFT_IOA says', () => {
    expect(typicalCanopy('Conifer', 'Non woodland')).toEqual({ group: 'Other', heightM: 0 });
    expect(typicalCanopy('Grassland', 'Non woodland').heightM).toBe(0);
  });
  it('unknown/blank/odd-cased values fall back to Other, height 0, without throwing', () => {
    for (const v of ['Urban', 'Road', 'Quarry', '', null, undefined, '  conifer  ', 'nonsense-value']) {
      const r = typicalCanopy(v);
      expect(r.heightM).toBe(0);
    }
  });
  it('every IFT_GROUP value has a corresponding GROUP_HEIGHT_M entry', () => {
    for (const group of Object.values(IFT_GROUP)) expect(GROUP_HEIGHT_M).toHaveProperty(group);
  });
});
