// wirelessIds.js — ID generation for wireless assets. Pure. IDs are stable once
// created (never re-numbered) and unique within their collection.

export const WIRELESS_ID_TAGS = { site: 'WS', link: 'WL', sector: 'WSEC' };

/** Next free ID like "SCOT-PH1-WS-003": one above the highest existing numeric suffix. */
export function nextWirelessId(kind, areaId, existingIds) {
  const tag = WIRELESS_ID_TAGS[kind];
  if (!tag) throw new RangeError(`unknown wireless kind "${kind}"`);
  const prefix = `${areaId || 'XX-XX'}-${tag}-`;
  let max = 0;
  for (const id of existingIds || []) {
    const s = String(id ?? '');
    if (s.startsWith(prefix)) {
      const n = Number(s.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
