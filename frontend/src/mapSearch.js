// mapSearch.js — postcode/asset search + project-extent camera helpers.
//
// Extracted from App.svelte (16 Jul 2026 refactor). The matching/bounds
// logic is deliberately split from the map/camera side effects so it can be
// unit-tested against a plain state object (see mapSearch.test.js) — the
// functions that take `map` are thin camera/marker wrappers around the pure
// parts. Behaviour is unchanged from the in-component originals.

import { setSearchMarker } from './mapTools.js';
import { showToast } from './toast.js';

// UK postcode shape (spaces already stripped) — used to decide whether a
// failed local search is worth a live postcodes.io lookup. Deliberately
// permissive; postcodes.io is the real validator.
export const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

// Every ID-bearing collection the asset search scans, in scan order.
const SEARCH_COLLECTIONS = [
  { key: 'chambers',      idProp: 'chamber_id', label: 'Chamber' },
  { key: 'ducts',         idProp: 'duct_id',    label: 'Duct' },
  { key: 'joints',        idProp: 'joint_id',   label: 'Joint' },
  { key: 'dropDucts',     idProp: 'ddct_id',    label: 'Drop Duct' },
  { key: 'cables',        idProp: 'cable_id',   label: 'Cable' },
  { key: 'bundles',       idProp: 'bundle_id',  label: 'Bundle' },
  { key: 'poles',         idProp: 'pole_id',    label: 'Pole' },
  { key: 'cbts',          idProp: 'cbt_id',     label: 'CBT' },
  { key: 'spans',         idProp: 'span_id',    label: 'Span' },
  { key: 'aerialDrops',   idProp: 'adrop_id',   label: 'Aerial Drop' },
  { key: 'cbtTails',      idProp: 'tail_id',    label: 'CBT Tail' },
  { key: 'addressPoints', idProp: 'uprn',       label: 'Premise' },
];

// ── Pure matching (unit-testable, no map/DOM/network) ───────────────────────

/** All address points whose postcode equals the query (space/case-insensitive). */
export function matchPostcode(state, query) {
  const qPostcode = query.toUpperCase().replace(/\s+/g, '');
  return (state.addressPoints || []).filter(a => {
    const pc = String(a.properties?.postcode || '').replace(/\s+/g, '').toUpperCase();
    return pc && pc === qPostcode;
  });
}

/**
 * First asset whose ID matches the query — exact match across ALL collections
 * first, then a "starts with" fallback pass, mirroring the original two-pass
 * order (a partial ID never shadows an exact one elsewhere).
 * @returns {{ feature, label }|null}
 */
export function matchAsset(state, query) {
  const qNorm = query.toUpperCase();
  for (const { key, idProp, label } of SEARCH_COLLECTIONS) {
    const exact = (state[key] || []).find(f => String(f.properties?.[idProp] || '').toUpperCase() === qNorm);
    if (exact) return { feature: exact, label };
  }
  for (const { key, idProp, label } of SEARCH_COLLECTIONS) {
    const partial = (state[key] || []).find(f => String(f.properties?.[idProp] || '').toUpperCase().startsWith(qNorm));
    if (partial) return { feature: partial, label };
  }
  return null;
}

/** A zoomable [lng,lat] for a found feature: point coords, or a line's midpoint vertex. */
export function featureCenter(feature) {
  const geom = feature?.geometry;
  if (geom?.type === 'Point') return geom.coordinates;
  if (geom?.type === 'LineString' && geom.coordinates?.length) {
    return geom.coordinates[Math.floor(geom.coordinates.length / 2)];
  }
  return null;
}

/**
 * Bounding box of everything a project contains — every collection's
 * geometry, not just build area or cabinet, since early-stage projects may
 * have neither yet. Returns [[minLng,minLat],[maxLng,maxLat]] or null for a
 * genuinely empty project.
 */
export function projectBounds(state) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let found = false;
  const addCoord = (c) => {
    if (!c || c.length < 2) return;
    const [lng, lat] = c;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    found = true;
  };
  const addGeom = (geom) => {
    if (!geom) return;
    if (geom.type === 'Point') addCoord(geom.coordinates);
    else if (geom.type === 'LineString') geom.coordinates.forEach(addCoord);
    else if (geom.type === 'MultiLineString') geom.coordinates.forEach(ls => ls.forEach(addCoord));
    else if (geom.type === 'Polygon') geom.coordinates.forEach(ring => ring.forEach(addCoord));
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(addCoord)));
  };

  if (state.cabinet) addGeom(state.cabinet.geometry);
  if (state.buildArea) addGeom(state.buildArea.geometry);
  for (const { key } of SEARCH_COLLECTIONS) {
    for (const f of (state[key] || [])) addGeom(f.geometry);
  }
  return found ? [[minLng, minLat], [maxLng, maxLat]] : null;
}

// ── Map-facing wrappers (camera + marker + toast side effects) ──────────────

/** Fit the camera to the project's extent. No-op on an empty project. */
export function fitToProject(map, state) {
  if (!map) return;
  const bounds = projectBounds(state);
  if (!bounds) return;   // genuinely empty project — leave the fallback view
  map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 600 });
}

/**
 * Full search flow, unchanged from App.svelte: local postcode match →
 * local asset-ID match → (postcode-shaped queries only) live postcodes.io
 * geocode with a 5s timeout → "not found" toast. See the original comment
 * block in git history for the full pass-ordering rationale.
 */
export async function searchAndZoom(map, state, rawQuery) {
  const q = (rawQuery || '').trim();
  if (!q || !map) return;
  const qPostcode = q.toUpperCase().replace(/\s+/g, '');

  const postcodeMatches = matchPostcode(state, q);
  if (postcodeMatches.length > 0) {
    const [lng, lat] = postcodeMatches[0].geometry.coordinates;
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), postcodeMatches.length > 1 ? 16 : 18), duration: 600 });
    setSearchMarker(map, lng, lat);
    showToast(`Found ${postcodeMatches.length} premise(s) at ${q}.`);
    return;
  }

  const found = matchAsset(state, q);
  if (found) {
    const center = featureCenter(found.feature);
    if (center) {
      map.easeTo({ center, zoom: Math.max(map.getZoom(), 18), duration: 600 });
      setSearchMarker(map, center[0], center[1]);
      showToast(`Found ${found.label} ${q}.`);
    } else {
      showToast(`Found ${found.label} ${q}, but it has no location to zoom to.`);
    }
    return;
  }

  if (UK_POSTCODE_RE.test(qPostcode)) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(qPostcode)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const { longitude, latitude } = data.result || {};
        if (typeof longitude === 'number' && typeof latitude === 'number') {
          map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 15), duration: 600 });
          setSearchMarker(map, longitude, latitude);
          showToast(`Found ${q} via postcodes.io — not in this project's imported premises.`);
          return;
        }
      }
      // 404 (not a real postcode) or an unexpected response shape — fall
      // through to the generic "not found" toast below, same as before.
    } catch (e) {
      // Offline, timed out, or postcodes.io is down — fail quietly to the
      // same "not found" toast rather than surfacing a raw network error.
      console.error('[search] postcodes.io lookup failed:', e);
    }
  }

  showToast(`No postcode or asset matching "${q}" found in this project.`);
}
