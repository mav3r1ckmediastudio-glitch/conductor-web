// wirelessTools.js — map interaction for the wireless layer: place a site, add
// a sector to a site, draw a PtP link between two sites, move a site. Each
// tool follows the same contract as mapDrawTools.js: it returns null (armed) or
// { error }, calls onFinish with pending data, and tears itself down on Escape.

import { projectStore } from './projectStore.js';
import { showToast } from './toast.js';
import { clearTool, setActiveTool } from './toolSession.js';
import { WL, setWirelessRubber } from './wirelessLayers.js';

const PICK_PX = 12;

/** Nearest wireless site under a screen point, or null. */
export function pickWirelessSite(map, point) {
  if (!map.getLayer(WL.sitesLayer)) return null;
  const box = [[point.x - PICK_PX, point.y - PICK_PX], [point.x + PICK_PX, point.y + PICK_PX]];
  const hits = map.queryRenderedFeatures(box, { layers: [WL.sitesLayer] });
  if (!hits.length) return null;
  const id = hits[0].properties?.site_id;
  return projectStore.wirelessSites.find(f => f.properties?.site_id === id) || null;
}

function arm(map, { onClick, onMove, cursor = 'crosshair' }) {
  clearTool(map);
  map.getCanvas().style.cursor = cursor;
  const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
  function cleanup() {
    map.off('click', onClick);
    if (onMove) map.off('mousemove', onMove);
    document.removeEventListener('keydown', onKey);
    map.getCanvas().style.cursor = '';
    setWirelessRubber(map, null);
  }
  map.on('click', onClick);
  if (onMove) map.on('mousemove', onMove);
  document.addEventListener('keydown', onKey);
  setActiveTool({ cleanup });
  return cleanup;
}

export function activateWirelessSiteTool(map, onFinish) {
  if (!projectStore.project) return { error: 'Create a project first.' };
  const areaId = projectStore.project?.areaId || 'XX-XX';
  const cleanup = arm(map, {
    onClick: (e) => {
      onFinish({ lng: e.lngLat.lng, lat: e.lngLat.lat, site_id: projectStore.nextWirelessId('site'), area_id: areaId });
      cleanup();
    },
  });
  return null;
}

export function activateWirelessSectorTool(map, onFinish) {
  if (!projectStore.wirelessSites.length) return { error: 'Place a wireless site first — a sector is mounted on a site.' };
  const cleanup = arm(map, {
    cursor: 'pointer',
    onClick: (e) => {
      const site = pickWirelessSite(map, e.point);
      if (!site) { showToast('Click a wireless site to add a sector to it.'); return; }
      const [lng, lat] = site.geometry.coordinates;
      onFinish({ site_id: site.properties.site_id, lng, lat, sector_id: projectStore.nextWirelessId('sector') });
      cleanup();
    },
  });
  return null;
}

export function activateWirelessLinkTool(map, onFinish) {
  if (projectStore.wirelessSites.length < 2) return { error: 'Place at least two wireless sites before drawing a link.' };
  let first = null;
  const cleanup = arm(map, {
    cursor: 'pointer',
    onMove: (e) => { if (first) setWirelessRubber(map, [first.geometry.coordinates, [e.lngLat.lng, e.lngLat.lat]]); },
    onClick: (e) => {
      const site = pickWirelessSite(map, e.point);
      if (!site) { showToast(first ? 'Click the second wireless site.' : 'Click the first wireless site.'); return; }
      if (!first) { first = site; showToast(`Link from ${site.properties.site_id} — now click the other end.`); return; }
      const a = first.properties.site_id, b = site.properties.site_id;
      if (a === b) { showToast('A link needs two different sites.'); return; }
      const dup = projectStore.wirelessLinks.some(l => (l.properties.site_a === a && l.properties.site_b === b) || (l.properties.site_a === b && l.properties.site_b === a));
      if (dup) { showToast(`A link between ${a} and ${b} already exists.`); return; }
      onFinish({ site_a: a, site_b: b, coordinates: [first.geometry.coordinates, site.geometry.coordinates], link_id: projectStore.nextWirelessId('link') });
      cleanup();
    },
  });
  return null;
}

export function activateWirelessMoveTool(map, onFinish) {
  if (!projectStore.wirelessSites.length) return { error: 'There are no wireless sites to move.' };
  let picked = null;
  const cleanup = arm(map, {
    cursor: 'pointer',
    onMove: (e) => { if (picked) setWirelessRubber(map, [picked.geometry.coordinates, [e.lngLat.lng, e.lngLat.lat]]); },
    onClick: (e) => {
      if (!picked) {
        picked = pickWirelessSite(map, e.point);
        if (!picked) showToast('Click the wireless site you want to move.');
        else showToast(`Moving ${picked.properties.site_id} — click its new position.`);
        return;
      }
      const id = picked.properties.site_id;
      projectStore.moveWirelessSite(id, [e.lngLat.lng, e.lngLat.lat]);
      onFinish({ site_id: id });
      cleanup();
    },
  });
  return null;
}
