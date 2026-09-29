// mapGeom.js
// Pure geometry / GeoJSON helpers (WGS84). No side effects, no store — unit-testable.

// ── HELPERS ───────────────────────────────────────────────────────────────────

export function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

export function pointFC(lng, lat) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }],
  };
}

export function pointInPolygon(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function haversine(lng1, lat1, lng2, lat2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function haversineChain(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversine(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1]);
  }
  return total;
}

// Pick for 3D-only line assets (spans, aerial drops, CBT tails) that have no
// 2D MapLibre layer. Tests screen-space distance from click point to each
// segment of the feature's 2D coordinate chain (perpendicular distance to the
// whole segment, not just its midpoint).
export function _distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// ── COMPASS LEG ───────────────────────────────────────────────────────────────

export function compassLeg(fromLng, fromLat, toLng, toLat) {
  const dLng = toLng - fromLng;
  const dLat = toLat - fromLat;
  const bearing = Math.atan2(dLng, dLat) * 180 / Math.PI;
  const b = ((bearing % 360) + 360) % 360;
  if (b >= 315 || b < 45)  return 'N';
  if (b >= 45  && b < 135) return 'E';
  if (b >= 135 && b < 225) return 'S';
  return 'W';
}


/**
 * Area-weighted centroid of a Polygon or MultiPolygon (exterior rings only —
 * holes are ignored, which is fine for a "does this stand roughly sit inside
 * the build area" test, not a survey-grade calculation). Standard shoelace
 * centroid per ring, combined by ring area for MultiPolygon.
 * @returns [lng, lat] or null if the geometry has no usable ring.
 */
export function featureCentroid(geometry) {
  if (!geometry) return null;
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates.map(poly => poly[0])
    : null;
  if (!rings) return null;
  let cx = 0, cy = 0, totalArea = 0;
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    let a = 0, rx = 0, ry = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      a += cross; rx += (x0 + x1) * cross; ry += (y0 + y1) * cross;
    }
    a /= 2;
    if (a === 0) continue;                 // degenerate ring; skip rather than divide by zero
    cx += (rx / (6 * a)) * Math.abs(a);
    cy += (ry / (6 * a)) * Math.abs(a);
    totalArea += Math.abs(a);
  }
  if (totalArea === 0) return null;
  return [cx / totalArea, cy / totalArea];
}

/**
 * Polygon/MultiPolygon features whose centroid falls inside `ring` (a build
 * area's outer ring, [lng,lat] pairs). Whole-feature keep/discard — a stand
 * straddling the boundary is kept or dropped entirely, never trimmed at the
 * edge. See applyForestryCookieCutter in mapDrawTools.js for why that's an
 * accepted, stated limitation rather than a true polygon clip.
 */
export function filterByCentroidInRing(features, ring) {
  return (features || []).filter(f => {
    const c = featureCentroid(f.geometry);
    return c ? pointInPolygon(c[0], c[1], ring) : false;
  });
}
