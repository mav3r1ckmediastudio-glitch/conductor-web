// wirelessGeo.js
// Pure geodesy helpers for wireless (PtP / PtMP) planning. WGS84 lng/lat in,
// metres/degrees out. No store, no map, no DOM — unit-testable.
//
// Propagation maths MUST use true ground distance (haversine), never
// Web-Mercator metres: at Perthshire latitudes mercator overstates distance
// by ~1.8x (see mercatorScale).

import { haversine } from './mapGeom.js';

const R_EARTH_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** True ground distance in metres between two lng/lat points. */
export function groundDistanceM(a, b) {
  return haversine(a.lng, a.lat, b.lng, b.lat);
}

/** Initial great-circle bearing a -> b, degrees clockwise from true north, [0,360). */
export function bearingDeg(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat);
  const dl = toRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached from `from` travelling `distM` on initial bearing `brgDeg`. */
export function destinationPoint(from, brgDeg, distM) {
  const d = distM / R_EARTH_M;
  const b = toRad(brgDeg);
  const p1 = toRad(from.lat), l1 = toRad(from.lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(p1),
    Math.cos(d) - Math.sin(p1) * Math.sin(p2),
  );
  return { lng: ((toDeg(l2) + 540) % 360) - 180, lat: toDeg(p2) };
}

/**
 * Web-Mercator distance inflation at a latitude (mercator metres per ground
 * metre). ~1.81 at 56.5N. Use only to convert between mercator cell sizes and
 * ground distances — never feed mercator metres into a path-loss calculation.
 */
export function mercatorScale(latDeg) {
  return 1 / Math.cos(toRad(latDeg));
}

/**
 * Evenly spaced samples along the great circle a -> b, endpoints included.
 * Returns [{ lng, lat, dM }] with dM the ground distance from a.
 * Spacing is <= stepM. Identical points return a single sample.
 */
export function interpolatePath(a, b, stepM) {
  if (!(stepM > 0)) throw new RangeError('stepM must be > 0');
  const total = groundDistanceM(a, b);
  if (total === 0) return [{ lng: a.lng, lat: a.lat, dM: 0 }];
  const n = Math.max(1, Math.ceil(total / stepM));
  const delta = total / R_EARTH_M;
  const p1 = toRad(a.lat), l1 = toRad(a.lng), p2 = toRad(b.lat), l2 = toRad(b.lng);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * delta) / Math.sin(delta);
    const B = Math.sin(f * delta) / Math.sin(delta);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push({
      lng: toDeg(Math.atan2(y, x)),
      lat: toDeg(Math.atan2(z, Math.hypot(x, y))),
      dM: f * total,
    });
  }
  // Pin endpoints exactly so callers can compare them to the inputs.
  out[0] = { lng: a.lng, lat: a.lat, dM: 0 };
  out[n] = { lng: b.lng, lat: b.lat, dM: total };
  return out;
}
