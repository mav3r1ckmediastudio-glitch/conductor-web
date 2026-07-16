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
