// wirelessTools.js — map interaction for the wireless layer: place a site, add
// a sector to a site, draw a PtP link between two sites, move a site. Each
// tool follows the same contract as mapDrawTools.js: it returns null (armed) or
// { error }, calls onFinish with pending data, and tears itself down on Escape.

import { projectStore } from './projectStore.js';
import { showToast } from './toast.js';
import { clearTool, setActiveTool } from './toolSession.js';
import { WL, setWirelessRubber, setSectorPreview } from './wirelessLayers.js';
import { azimuthFromPoint } from './wirelessAim.js';

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

/**
 * Drag-to-aim for sector handles (the dot at the end of the dashed line).
 * Works on stored sectors and on the ghost of the sector whose form is open.
 * Hold Shift to snap to 5 degrees. Installed once per map; the layer-scoped
 * listeners survive basemap style reloads.
 *
 * onAim({ sectorId, azimuth, phase }) — phase is 'move' or 'end'. sectorId is
 * '' for the ghost (the form owns that value); for a stored sector the caller
 * saves the azimuth on 'end'.
 */
export function installSectorAiming(map, onAim) {
  let drag = null;
  const layers = [WL.aimHandle, WL.previewHandle];
  const canvas = () => map.getCanvas();

  function begin(e) {
    if (drag || (e.points && e.points.length > 1)) return;
    const f = e.features?.[0];
    if (!f) return;
    e.preventDefault();                                    // stops the map panning under the drag
    const p = f.properties;
    drag = { sectorId: p.sector_id || '', from: { lng: Number(p.lng), lat: Number(p.lat) }, bw: Number(p.bw), r: Number(p.r), az: null };
    canvas().style.cursor = 'grabbing';
    map.on('mousemove', move); map.on('touchmove', move);
    map.once('mouseup', end); map.once('touchend', end);
  }
  function move(e) {
    if (!drag) return;
    const az = azimuthFromPoint(drag.from, e.lngLat, { snapDeg: e.originalEvent?.shiftKey ? 5 : 0 });
    if (az == null) return;
    drag.az = az;
    setSectorPreview(map, { lng: drag.from.lng, lat: drag.from.lat, azimuthDeg: az, beamwidthDeg: drag.bw, rangeM: drag.r });
    onAim({ sectorId: drag.sectorId, azimuth: az, phase: 'move' });
  }
  function end() {
    if (!drag) return;
    map.off('mousemove', move); map.off('touchmove', move);
    canvas().style.cursor = '';
    const d = drag; drag = null;
    if (d.az != null) onAim({ sectorId: d.sectorId, azimuth: d.az, phase: 'end' });
    if (d.sectorId) setSectorPreview(map, null);           // a stored sector's ghost is only for the drag itself
  }
  for (const id of layers) {
    map.on('mousedown', id, begin); map.on('touchstart', id, begin);
    map.on('mouseenter', id, () => { if (!drag) canvas().style.cursor = 'grab'; });
    map.on('mouseleave', id, () => { if (!drag) canvas().style.cursor = ''; });
  }
}
