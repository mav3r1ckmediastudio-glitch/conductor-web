// wirelessLinkBudget.js
// Pure, deterministic point-to-point link budget. Free-space model only: any
// extra loss (rain, foliage, diffraction) must be supplied via extraLossDb.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Free-space path loss, dB. freq in GHz, distance in km. */
export function fsplDb(freqGHz, distanceKm) {
  if (!(freqGHz > 0) || !(distanceKm > 0)) throw new RangeError('freqGHz and distanceKm must be > 0');
  return 92.45 + 20 * Math.log10(freqGHz) + 20 * Math.log10(distanceKm);
}

/**
 * One direction of a link.
 * @returns {{ fsplDb:number, eirpDbm:number, rxPowerDbm:number, fadeMarginDb:number }}
 * Throws on missing/non-finite numeric input — callers must check completeness
 * first (see wirelessAnalysis.js) so a gap can never silently become a 0.
 */
export function computeLinkBudget(p) {
  const req = ['txPowerDbm', 'txGainDbi', 'rxGainDbi', 'freqGHz', 'distanceKm', 'rxSensitivityDbm'];
  for (const k of req) if (!isNum(p[k])) throw new TypeError(`computeLinkBudget: ${k} must be a finite number`);
  const txCable = p.txCableLossDb ?? 0, rxCable = p.rxCableLossDb ?? 0, extra = p.extraLossDb ?? 0;
  for (const v of [txCable, rxCable, extra]) if (!isNum(v)) throw new TypeError('computeLinkBudget: loss terms must be finite numbers');
  const loss = fsplDb(p.freqGHz, p.distanceKm);
  const eirpDbm = p.txPowerDbm + p.txGainDbi - txCable;
  const rxPowerDbm = eirpDbm - loss - extra + p.rxGainDbi - rxCable;
  return { fsplDb: loss, eirpDbm, rxPowerDbm, fadeMarginDb: rxPowerDbm - p.rxSensitivityDbm };
}
