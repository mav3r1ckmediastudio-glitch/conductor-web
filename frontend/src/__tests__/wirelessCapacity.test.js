import { describe, it, expect } from 'vitest';
import { buildBackhaulTree, computeCapacityDemand } from '../wirelessCapacity.js';

// Boreland (hub) --L1-- Relay (5 customers) --L2-- Killin1 (40 customers)
//                                           \--L3-- Killin2 (30 customers)
const site = (id, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { site_id: id, ...props } });
const link = (id, a, b, props = {}) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0]] }, properties: { link_id: id, site_a: a, site_b: b, ...props } });

function topology() {
  const sites = [
    site('Boreland', { is_hub: true }),
    site('Relay', { customers_served: 5 }),
    site('Killin1', { customers_served: 40 }),
    site('Killin2', { customers_served: 30 }),
  ];
  const links = [
    link('L1', 'Boreland', 'Relay', { rated_capacity_mbps: 1340 }),
    link('L2', 'Relay', 'Killin1', { rated_capacity_mbps: 1200 }),
    link('L3', 'Relay', 'Killin2', { rated_capacity_mbps: 500 }),
  ];
  return { sites, links };
}

const SETTINGS = { serviceTierMbps: 1000, contentionRatio: 20, targetUtilizationPct: 70 };

describe('buildBackhaulTree', () => {
  it('finds the hub and builds a parent/link map for every reachable site', () => {
    const { sites, links } = topology();
    const t = buildBackhaulTree(sites, links);
    expect(t.hubId).toBe('Boreland');
    expect(t.parentOf.get('Relay')).toBe('Boreland');
    expect(t.parentOf.get('Killin1')).toBe('Relay');
    expect(t.parentOf.get('Killin2')).toBe('Relay');
    expect(t.linkOf.get('Relay')).toBe('L1');
    expect(t.unreachable).toEqual([]);
    expect(t.issues).toEqual([]);
  });

  it('warns when no site is marked as the hub', () => {
    const { sites, links } = topology();
    for (const s of sites) s.properties.is_hub = false;
    const t = buildBackhaulTree(sites, links);
    expect(t.hubId).toBeNull();
    expect(t.issues.find(i => i.code === 'CAPACITY_NO_HUB').severity).toBe('warning');
  });

  it('errors when more than one site is marked as the hub', () => {
    const { sites, links } = topology();
    sites[1].properties.is_hub = true;
    const t = buildBackhaulTree(sites, links);
    expect(t.hubId).toBeNull();
    const i = t.issues.find(x => x.code === 'CAPACITY_MULTIPLE_HUBS');
    expect(i).toBeTruthy();
    expect(i.severity).toBe('error');
  });

  it('flags a site with no path to the hub', () => {
    const { sites, links } = topology();
    sites.push(site('Stranded', { customers_served: 2 }));
    const t = buildBackhaulTree(sites, links);
    expect(t.unreachable).toEqual(['Stranded']);
    expect(t.issues.find(i => i.code === 'CAPACITY_UNREACHABLE').id).toBe('Stranded');
  });

  it('a loop in the backhaul graph is flagged, not silently resolved', () => {
    const { sites, links } = topology();
    links.push(link('L4', 'Killin1', 'Killin2')); // closes Relay-Killin1-Killin2-Relay
    const t = buildBackhaulTree(sites, links);
    const cycleIssues = t.issues.filter(i => i.code === 'CAPACITY_CYCLE');
    expect(cycleIssues).toHaveLength(1);
    expect(cycleIssues[0].message).toContain('L4');
    // Ordinary tree edges must still be intact — the bug this guards against
    // mis-flagged the parent-return edge (Relay's own link back to Boreland).
    expect(t.parentOf.get('Relay')).toBe('Boreland');
    expect(t.parentOf.get('Killin1')).toBe('Relay');
  });
});

describe('computeCapacityDemand', () => {
  it('rolls every downstream site\'s demand onto every link on its path to the hub', () => {
    const { sites, links } = topology();
    const r = computeCapacityDemand(sites, links, SETTINGS);
    // L1 is the trunk: carries Relay's own 5 customers PLUS both Killin sites.
    expect(r.perLink.get('L1').requiredMbps).toBeCloseTo((5 + 40 + 30) * 1000 / 20, 5);
    expect(r.perLink.get('L2').requiredMbps).toBeCloseTo(40 * 1000 / 20, 5);
    expect(r.perLink.get('L3').requiredMbps).toBeCloseTo(30 * 1000 / 20, 5);
    expect(r.totalCustomers).toBe(75);
  });

  it('flags a link whose required demand exceeds its rated capacity', () => {
    const { sites, links } = topology();
    links[2].properties.rated_capacity_mbps = 200; // L3 needs 30*1000/20 = 1500
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.perLink.get('L3').status).toBe('over');
    expect(r.issues.find(i => i.code === 'LINK_CAPACITY_EXCEEDED' && i.id === 'L3')).toBeTruthy();
  });

  it('warns, but does not error, when a link is near its target utilization ceiling', () => {
    const { sites, links } = topology();
    // L2 needs 40*1000/20 = 2000 Mbps; rate it so that is 80% (above the 70% target, below 100%).
    links[1].properties.rated_capacity_mbps = 2500;
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.perLink.get('L2').status).toBe('near');
    const i = r.issues.find(x => x.code === 'LINK_CAPACITY_NEAR_LIMIT' && x.id === 'L2');
    expect(i).toBeTruthy();
    expect(i.severity).toBe('warning');
  });

  it('warns when a link carrying demand has no rated capacity recorded', () => {
    const { sites, links } = topology();
    delete links[0].properties.rated_capacity_mbps;
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.perLink.get('L1').status).toBe('unrated');
    expect(r.issues.find(i => i.code === 'LINK_CAPACITY_UNRATED' && i.id === 'L1')).toBeTruthy();
  });

  it('does not warn about an unrated link that carries no demand', () => {
    const { sites, links } = topology();
    links[2].properties.customers_served = undefined;
    delete links[2].properties.rated_capacity_mbps;
    sites.find(s => s.properties.site_id === 'Killin2').properties.customers_served = 0;
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.perLink.get('L3').status).toBe('ok');
    expect(r.issues.find(i => i.code === 'LINK_CAPACITY_UNRATED' && i.id === 'L3')).toBeUndefined();
  });

  it('warns about a reachable site with no customers-served value, treating it as zero', () => {
    const { sites, links } = topology();
    delete sites[1].properties.customers_served; // Relay
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.perSite.get('Relay').customers).toBe(0);
    expect(r.issues.find(i => i.code === 'SITE_CUSTOMERS_UNSPECIFIED' && i.id === 'Relay')).toBeTruthy();
    // L2/L3 demand is unaffected — only Relay's own contribution to L1 drops.
    expect(r.perLink.get('L1').requiredMbps).toBeCloseTo((40 + 30) * 1000 / 20, 5);
  });

  it('does not warn about an unreachable site\'s missing customers value (it already has its own issue)', () => {
    const { sites, links } = topology();
    sites.push(site('Stranded'));
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.issues.find(i => i.code === 'SITE_CUSTOMERS_UNSPECIFIED' && i.id === 'Stranded')).toBeUndefined();
    expect(r.issues.find(i => i.code === 'CAPACITY_UNREACHABLE' && i.id === 'Stranded')).toBeTruthy();
  });

  it('the hub\'s own customers count toward the total but never roll onto a link', () => {
    const { sites, links } = topology();
    sites.find(s => s.properties.site_id === 'Boreland').properties.customers_served = 10;
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.totalCustomers).toBe(85);
    expect(r.perLink.get('L1').requiredMbps).toBeCloseTo((5 + 40 + 30) * 1000 / 20, 5); // unchanged
  });

  it('is deterministic across repeated calls on the same inputs', () => {
    const { sites, links } = topology();
    const a = computeCapacityDemand(sites, links, SETTINGS);
    const b = computeCapacityDemand(sites, links, SETTINGS);
    expect(a.totalRequiredMbps).toBe(b.totalRequiredMbps);
    expect([...a.perLink.entries()]).toEqual([...b.perLink.entries()]);
  });

  it('falls back to built-in defaults when settings are not supplied', () => {
    const { sites, links } = topology();
    const r = computeCapacityDemand(sites, links, {});
    expect(r.perLink.get('L2').requiredMbps).toBeCloseTo(40 * 1000 / 20, 5);
  });

  it('with no hub at all, every site is unreachable and nothing is rolled up', () => {
    const { sites, links } = topology();
    sites[0].properties.is_hub = false;
    const r = computeCapacityDemand(sites, links, SETTINGS);
    expect(r.hubId).toBeNull();
    expect(r.issues.find(i => i.code === 'CAPACITY_NO_HUB')).toBeTruthy();
    for (const v of r.perLink.values()) expect(v.requiredMbps).toBe(0);
  });
});
