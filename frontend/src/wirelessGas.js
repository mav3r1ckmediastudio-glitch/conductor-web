// wirelessGas.js — specific gaseous attenuation (dB/km) for terrestrial paths,
// ITU-R P.676-12 Annex 1 line-by-line method (oxygen + water vapour), at sea
// level. Pure and deterministic.
//
// Why it matters: oxygen absorption peaks near 60 GHz (~15 dB/km) and falls
// away steeply either side, so a 60 GHz-band radio on 60.5 GHz loses ~25 times
// more per km than the same radio on 69 GHz. A flat "60 GHz" figure is wrong
// for most of the 57-71 GHz band.
//
// NOT included here: rain (see wirelessRain.js), cloud, foliage, multipath.
// Local altitude is ignored (sea level).

import { OXYGEN_LINES, WATER_VAPOUR_LINES } from './wirelessGasData.js';

export const ITU_STANDARD_ATMOSPHERE = Object.freeze({ temperatureC: 15, pressureHpa: 1013.25, waterVapourGm3: 7.5 });

/**
 * @param {number} fGHz  frequency, 1-1000 GHz
 * @param {{temperatureC?:number, pressureHpa?:number, waterVapourGm3?:number}} atm  defaults: ITU standard atmosphere
 * @returns {number} specific attenuation in dB/km (oxygen + water vapour + dry continuum)
 */
export function gaseousAttenuationDbPerKm(fGHz, atm = {}) {
  if (!(fGHz > 0)) return 0;
  const T = (atm.temperatureC ?? ITU_STANDARD_ATMOSPHERE.temperatureC) + 273.15;
  const ptot = atm.pressureHpa ?? ITU_STANDARD_ATMOSPHERE.pressureHpa;
  const rho = atm.waterVapourGm3 ?? ITU_STANDARD_ATMOSPHERE.waterVapourGm3;
  const th = 300 / T;
  const e = (rho * T) / 216.7;          // water vapour partial pressure, hPa (eq. 4)
  const p = ptot - e;                    // dry air pressure, hPa

  let nOx = 0;
  for (const [f0, a1, a2, a3, a4, a5, a6] of OXYGEN_LINES) {
    const S = a1 * 1e-7 * p * th ** 3 * Math.exp(a2 * (1 - th));                       // eq. 3
    let df = a3 * 1e-4 * (p * th ** (0.8 - a4) + 1.1 * e * th);                        // eq. 6a
    df = Math.sqrt(df * df + 2.25e-6);                                                  // eq. 6b (Zeeman)
    const delta = (a5 + a6 * th) * 1e-4 * (p + e) * th ** 0.8;                          // eq. 7
    const F = (fGHz / f0) * ((df - delta * (f0 - fGHz)) / ((f0 - fGHz) ** 2 + df * df)
                           + (df - delta * (f0 + fGHz)) / ((f0 + fGHz) ** 2 + df * df)); // eq. 5
    nOx += S * F;
  }
  const d = 5.6e-4 * (p + e) * th ** 0.8;                                               // eq. 9
  nOx += fGHz * p * th ** 2 * (6.14e-5 / (d * (1 + (fGHz / d) ** 2)) + (1.4e-12 * p * th ** 1.5) / (1 + 1.9e-5 * fGHz ** 1.5)); // eq. 8

  let nW = 0;
  for (const [f0, b1, b2, b3, b4, b5, b6] of WATER_VAPOUR_LINES) {
    const S = b1 * 1e-1 * e * th ** 3.5 * Math.exp(b2 * (1 - th));
    let df = b3 * 1e-4 * (p * th ** b4 + b5 * e * th ** b6);
    df = 0.535 * df + Math.sqrt(0.217 * df * df + (2.1316e-12 * f0 * f0) / th);        // eq. 6b (Doppler)
    const F = (fGHz / f0) * (df / ((f0 - fGHz) ** 2 + df * df) + df / ((f0 + fGHz) ** 2 + df * df));
    nW += S * F;
  }
  return 0.182 * fGHz * (nOx + nW);                                                    // eq. 1
}
