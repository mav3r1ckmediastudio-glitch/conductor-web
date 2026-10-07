// wirelessCapacity.js — Backhaul capacity planning: a topology/arithmetic
// check, deliberately kept separate from the RF physics in wirelessAnalysis.js.
//
// Customer demand at every non-hub site rolls up, link by link, to the single
// site marked as the backhaul hub (where traffic joins the wired network).
// Every link on that path must carry the sum of everything downstream of it,
// including a relay site's own customers — a trunk link is sized for
// everything behind it, not just the site at its far end.
//
// This is NOT RF-gated and has no "stale" state of its own: it runs live off
// the current sites/links/settings whenever the panel is open, because it is
// cheap arithmetic, not a terrain or link-budget calculation.
//
// Issue codes:
//   CAPACITY_NO_HUB            no site is marked as the backhaul hub (warning)
//   CAPACITY_MULTIPLE_HUBS     more than one site is marked as the hub
//   CAPACITY_UNREACHABLE       a site has no link path to the hub
//   CAPACITY_CYCLE             a link closes a loop; capacity can't roll up through it
//   SITE_CUSTOMERS_UNSPECIFIED a reachable non-hub site has no customers_served value (warning)
//   LINK_CAPACITY_UNRATED      a link carrying demand has no rated_capacity_mbps (warning)
//   LINK_CAPACITY_NEAR_LIMIT   required demand is within the target ceiling of rated capacity (warning)
//   LINK_CAPACITY_EXCEEDED     required demand exceeds the link's rated capacity

const P = (f) => (f && f.properties) || {};
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const issue = (code, message, scope, id, severity = 'error') => ({ code, message, scope, id, severity });

const DEFAULTS = { serviceTierMbps: 1000, contentionRatio: 20, targetUtilizationPct: 70 };

/**
 * BFS tree rooted at the single site with is_hub === true, over the
 * undirected link graph (site_a <-> site_b).
 * @returns {{ hubId: string|null, parentOf: Map<string,string>, linkOf: Map<string,string>, unreachable: string[], issues: Array }}
 */
export function buildBackhaulTree(sites, links) {
  const issues = [];
  const siteIds = (sites || []).map(s => P(s).site_id).filter(Boolean);
  const hubs = (sites || []).filter(s => P(s).is_hub === true).map(s => P(s).site_id);

  if (hubs.length > 1) {
    issues.push(issue('CAPACITY_MULTIPLE_HUBS',
      `${hubs.length} sites are marked as the backhaul hub (${hubs.join(', ')}); exactly one is required. Nothing has been rolled up.`,
      'site', hubs[0]));
    return { hubId: null, parentOf: new Map(), linkOf: new Map(), unreachable: siteIds, issues };
  }
  const hubId = hubs[0] || null;
  if (!hubId) {
    issues.push(issue('CAPACITY_NO_HUB',
      'No site is marked as the backhaul hub (where traffic joins the wired network). Mark exactly one site to roll up customer demand.',
      'site', null, 'warning'));
    return { hubId: null, parentOf: new Map(), linkOf: new Map(), unreachable: siteIds, issues };
  }

  const adj = new Map();
  for (const id of siteIds) adj.set(id, []);
  for (const l of links || []) {
    const p = P(l), a = p.site_a, b = p.site_b, linkId = p.link_id;
    if (!a || !b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a).push({ to: b, linkId });
    adj.get(b).push({ to: a, linkId });
  }

  const parentOf = new Map(), linkOf = new Map(), visited = new Set([hubId]);
  const seenCycleLinks = new Set();
  const queue = [hubId];
  while (queue.length) {
    const cur = queue.shift();
    const arrivedVia = linkOf.get(cur); // the edge used to discover `cur` itself (undefined for the hub)
    for (const { to, linkId } of adj.get(cur) || []) {
      if (linkId === arrivedVia) continue; // walking back the exact edge we arrived by — not a cycle
      if (visited.has(to)) {
        if (!seenCycleLinks.has(linkId)) {
          seenCycleLinks.add(linkId);
          issues.push(issue('CAPACITY_CYCLE',
            `Link ${linkId} closes a loop in the backhaul topology (${cur} ↔ ${to} is already connected another way). Redundant/ring backhaul is not modelled — capacity cannot be rolled up through a cycle.`,
            'link', linkId));
        }
        continue;
      }
      visited.add(to); parentOf.set(to, cur); linkOf.set(to, linkId);
      queue.push(to);
    }
  }

  const unreachable = siteIds.filter(id => id !== hubId && !visited.has(id));
  for (const id of unreachable) {
    issues.push(issue('CAPACITY_UNREACHABLE',
      `${id} has no link path to the backhaul hub (${hubId}); its customer demand cannot be rolled up.`,
      'site', id));
  }

  return { hubId, parentOf, linkOf, unreachable, issues };
}

/**
 * Customer demand rolled up through the backhaul tree and checked against
 * each link's rated capacity.
 * @param sites     wirelessSites GeoJSON features
 * @param links     wirelessLinks GeoJSON features
 * @param settings  resolved wireless settings (serviceTierMbps, contentionRatio, targetUtilizationPct)
 * @returns {{ hubId, perSite: Map, perLink: Map, totalCustomers: number, totalRequiredMbps: number, issues: Array }}
 */
export function computeCapacityDemand(sites, links, settings = {}) {
  const s = { ...DEFAULTS, ...settings };
  const { hubId, parentOf, linkOf, unreachable, issues: treeIssues } = buildBackhaulTree(sites, links);
  const issues = [...treeIssues];

  const perSite = new Map();
  for (const site of sites || []) {
    const p = P(site), id = p.site_id;
    if (!id) continue;
    const customers = num(p.customers_served);
    const n = customers ?? 0;
    perSite.set(id, { customers: n, specified: customers != null, requiredMbps: (n * s.serviceTierMbps) / s.contentionRatio });
    if (id !== hubId && customers == null && !unreachable.includes(id)) {
      issues.push(issue('SITE_CUSTOMERS_UNSPECIFIED',
        `${id} has no customers-served value; it is treated as 0 for backhaul sizing.`,
        'site', id, 'warning'));
    }
  }

  const perLink = new Map();
  for (const l of links || []) {
    const p = P(l);
    if (!p.link_id) continue;
    perLink.set(p.link_id, { requiredMbps: 0, ratedMbps: num(p.rated_capacity_mbps), utilizationPct: null, status: 'ok' });
  }

  // Roll every reachable non-hub site's demand onto every link on its path to the hub.
  if (hubId) {
    for (const id of parentOf.keys()) {
      const demand = perSite.get(id)?.requiredMbps || 0;
      if (!demand) continue;
      let cur = id;
      while (parentOf.has(cur)) {
        const linkId = linkOf.get(cur);
        const entry = perLink.get(linkId);
        if (entry) entry.requiredMbps += demand;
        cur = parentOf.get(cur);
      }
    }
  }

  for (const [linkId, v] of perLink) {
    if (v.ratedMbps == null) {
      v.status = v.requiredMbps > 0 ? 'unrated' : 'ok';
      if (v.requiredMbps > 0) {
        issues.push(issue('LINK_CAPACITY_UNRATED',
          `${linkId} requires an estimated ${Math.round(v.requiredMbps)} Mbps of backhaul but has no rated capacity recorded; its headroom cannot be checked.`,
          'link', linkId, 'warning'));
      }
      continue;
    }
    v.utilizationPct = v.ratedMbps > 0 ? (v.requiredMbps / v.ratedMbps) * 100 : null;
    if (v.utilizationPct == null) continue;
    if (v.utilizationPct > 100) {
      v.status = 'over';
      issues.push(issue('LINK_CAPACITY_EXCEEDED',
        `${linkId} needs an estimated ${Math.round(v.requiredMbps)} Mbps but is rated for only ${v.ratedMbps} Mbps (${Math.round(v.utilizationPct)}%).`,
        'link', linkId));
    } else if (v.utilizationPct > s.targetUtilizationPct) {
      v.status = 'near';
      issues.push(issue('LINK_CAPACITY_NEAR_LIMIT',
        `${linkId} is at ${Math.round(v.utilizationPct)}% of its rated capacity (target ceiling ${s.targetUtilizationPct}%).`,
        'link', linkId, 'warning'));
    } else {
      v.status = 'ok';
    }
  }

  let totalCustomers = 0, totalRequiredMbps = 0;
  for (const v of perSite.values()) { totalCustomers += v.customers; totalRequiredMbps += v.requiredMbps; }

  return { hubId, perSite, perLink, totalCustomers, totalRequiredMbps, issues };
}
