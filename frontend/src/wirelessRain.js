// wirelessRain.js — rain attenuation for terrestrial line-of-sight links.
//
//   Specific attenuation  ITU-R P.838-3   gamma = k R^alpha (dB/km)
//   Path attenuation      ITU-R P.530-17  effective path length and the
//                                         0.01% -> other-percentage scaling
//
// Pure and deterministic. Inputs are the frequency, the path length and the
// rain rate exceeded for 0.01% of an average year (R0.01, mm/h, a site value
// from ITU-R P.837). Horizontal path; the worse of horizontal and vertical
// polarisation is used, because the polarisation of the installed radios is
// not recorded.
//
// The method is defined for 1-100 GHz, path lengths up to about 60 km and
// percentages of time from 0.001% to 1%. RAIN OUTAGE ONLY: multipath, wet-
// antenna loss, snow, alignment drift and equipment failure are not included.

// P.838-3 Tables 1-4: [a_j, b_j, c_j] terms, then m and c.
const KH = { t: [[-5.33980, -0.10008, 1.13098], [-0.35351, 1.26970, 0.45400], [-0.23789, 0.86036, 0.15354], [-0.94158, 0.64552, 0.16817]], m: -0.18961, c: 0.71147 };
const KV = { t: [[-3.80595, 0.56934, 0.81061], [-3.44965, -0.22911, 0.51059], [-0.39902, 0.73042, 0.11899], [0.50167, 1.07319, 0.27195]], m: -0.16398, c: 0.63297 };
const AH = { t: [[-0.14318, 1.82442, -0.55187], [0.29591, 0.77564, 0.19822], [0.32177, 0.63773, 0.13164], [-5.37610, -0.96230, 1.47828], [16.1721, -3.29980, 3.43990]], m: 0.67849, c: -1.95537 };
const AV = { t: [[-0.07771, 2.33840, -0.76284], [0.56727, 0.95545, 0.54039], [-0.20238, 1.14520, 0.26809], [-48.2991, 0.791669, 0.116226], [48.5833, 0.791459, 0.116479]], m: -0.053739, c: 0.83433 };

const series = (T, lf) => T.t.reduce((s, [a, b, c]) => s + a * Math.exp(-(((lf - b) / c) ** 2)), 0) + T.m * lf + T.c;

/** P.838-3 coefficients at a frequency: { kH, aH, kV, aV } (k is linear, alpha dimensionless). */
export function rainCoefficients(fGHz) {
  const lf = Math.log10(fGHz);
  return { kH: 10 ** series(KH, lf), aH: series(AH, lf), kV: 10 ** series(KV, lf), aV: series(AV, lf) };
}

/** Specific rain attenuation in dB/km at rain rate R (mm/h); worse of H and V. */
export function rainSpecificDbPerKm(fGHz, rMmh) {
  if (!(fGHz > 0) || !(rMmh > 0)) return 0;
  const c = rainCoefficients(fGHz);
  return Math.max(c.kH * rMmh ** c.aH, c.kV * rMmh ** c.aV);
}

// One polarisation's A(0.01%) and the ITU percentage-scaling constants.
function a001For(k, alpha, fGHz, dKm, r001) {
  const denom = 0.477 * dKm ** 0.633 * r001 ** (0.073 * alpha) * fGHz ** 0.123 - 10.579 * (1 - Math.exp(-0.024 * dKm));
  const r = denom < 0.4 ? 2.5 : Math.min(1 / denom, 2.5);      // distance factor, at most 2.5
  return k * r001 ** alpha * r * dKm;                            // gamma * effective path length
}
function scaling(fGHz) {
  const c0 = fGHz >= 10 ? 0.12 + 0.4 * Math.log10(fGHz / 10) ** 0.8 : 0.12;
  return { c1: 0.07 ** c0 * 0.12 ** (1 - c0), c2: 0.855 * c0 + 0.546 * (1 - c0), c3: 0.139 * c0 + 0.043 * (1 - c0) };
}
const aP = (a001, s, p) => a001 * s.c1 * p ** -(s.c2 + s.c3 * Math.log10(p));

/** Path attenuation (dB) exceeded for pctTime % of the time (0.001-1). Worse of H and V. */
export function rainAttenuationDb({ fGHz, dKm, r001Mmh, pctTime }) {
  if (!(fGHz > 0) || !(dKm > 0) || !(r001Mmh > 0)) return 0;
  const c = rainCoefficients(fGHz), s = scaling(fGHz);
  const p = Math.min(1, Math.max(0.001, pctTime));
  return Math.max(aP(a001For(c.kH, c.aH, fGHz, dKm, r001Mmh), s, p), aP(a001For(c.kV, c.aV, fGHz, dKm, r001Mmh), s, p));
}

const HOURS_PER_YEAR = 8766;

/**
 * How available is the link against rain? Given the clear-sky margin (dB above
 * the receiver sensitivity you entered), find the percentage of time p at which
 * the rain fade equals that margin.
 *
 * @returns {{ a001Db, gammaDbPerKm, exceededPct, bound, availabilityPct, outageHoursPerYear }}
 *   bound: 'exact' (p found inside 0.001-1%), 'above' (fade never reaches the
 *   margin above 99.999%) or 'below' (worse than 99%, outside the method).
 */
export function rainAvailability({ fGHz, dKm, r001Mmh, marginDb }) {
  const a001 = rainAttenuationDb({ fGHz, dKm, r001Mmh, pctTime: 0.01 });
  const out = { a001Db: a001, gammaDbPerKm: rainSpecificDbPerKm(fGHz, r001Mmh) };
  if (!(marginDb > 0)) return { ...out, exceededPct: 100, bound: 'below', availabilityPct: 0, outageHoursPerYear: HOURS_PER_YEAR };
  const at = (p) => rainAttenuationDb({ fGHz, dKm, r001Mmh, pctTime: p });
  if (marginDb >= at(0.001)) return { ...out, exceededPct: 0.001, bound: 'above', availabilityPct: 99.999, outageHoursPerYear: HOURS_PER_YEAR * 1e-5 };
  if (marginDb <= at(1)) return { ...out, exceededPct: 1, bound: 'below', availabilityPct: 99, outageHoursPerYear: HOURS_PER_YEAR * 0.01 };
  let lo = Math.log10(0.001), hi = 0;                              // at() falls as p rises; bisect on log10 p
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(10 ** mid) > marginDb) lo = mid; else hi = mid; }
  const p = 10 ** ((lo + hi) / 2);
  return { ...out, exceededPct: p, bound: 'exact', availabilityPct: 100 - p, outageHoursPerYear: (p / 100) * HOURS_PER_YEAR };
}

/** Clear-sky margin (dB) needed so rain outage is no more than (100 - targetPct)% of the time. */
export function marginNeededDb({ fGHz, dKm, r001Mmh, targetAvailabilityPct }) {
  return rainAttenuationDb({ fGHz, dKm, r001Mmh, pctTime: 100 - targetAvailabilityPct });
}
