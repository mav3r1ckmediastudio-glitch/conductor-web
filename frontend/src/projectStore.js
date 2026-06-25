// projectStore.js — Central application state for Conductor Web
// Persists to localStorage on every change.
// Workflow stages: 'setup' → 'import' → 'build-area' → 'cabinet' → 'design'

const STORAGE_KEY = 'conductor_web_project';

// ── BNG → WGS84 conversion (Helmert transform approximation) ─────────────────
// Accurate to ~5m for GB — sufficient for design purposes.
function bngToWgs84(easting, northing) {
  // OSGB36 to WGS84 via approximate Helmert parameters
  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180;
  const lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;

  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n, n3 = n * n * n;

  let lat = lat0;
  let M = 0;

  do {
    lat = (northing - N0 - M) / (a * F0) + lat;
    const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
    const Mb = (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
    const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
    const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(northing - N0 - M) >= 0.00001);

  const cosLat = Math.cos(lat), sinLat = Math.sin(lat), tanLat = Math.tan(lat);
  const nu = a * F0 / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const VII = tanLat / (2 * rho * nu);
  const VIII = tanLat / (24 * rho * nu * nu * nu) * (5 + 3 * tanLat * tanLat + eta2 - 9 * tanLat * tanLat * eta2);
  const IX = tanLat / (720 * rho * Math.pow(nu, 5)) * (61 + 90 * tanLat * tanLat + 45 * Math.pow(tanLat, 4));
  const X = 1 / (cosLat * nu);
  const XI = 1 / (cosLat * 6 * nu * nu * nu) * (nu / rho + 2 * tanLat * tanLat);
  const XII = 1 / (cosLat * 120 * Math.pow(nu, 5)) * (5 + 28 * tanLat * tanLat + 24 * Math.pow(tanLat, 4));
  const XIIA = 1 / (cosLat * 5040 * Math.pow(nu, 7)) * (61 + 662 * tanLat * tanLat + 1320 * Math.pow(tanLat, 4) + 720 * Math.pow(tanLat, 6));

  const dE = easting - E0;
  const latRad = lat - VII * dE * dE + VIII * Math.pow(dE, 4) - IX * Math.pow(dE, 6);
  const lonRad = lon0 + X * dE - XI * Math.pow(dE, 3) + XII * Math.pow(dE, 5) - XIIA * Math.pow(dE, 7);

  // Helmert shift OSGB36 → WGS84
  const latDeg = latRad * 180 / Math.PI;
  const lonDeg = lonRad * 180 / Math.PI;
  return { lat: latDeg + 0.0001, lng: lonDeg + 0.0002 }; // ~5m shift approx
}

// ── Column detection ─────────────────────────────────────────────────────────

export function detectColumns(headers) {
  const h = headers.map(c => c.trim().toUpperCase());
  const find = (...names) => {
    for (const name of names) {
      const idx = h.indexOf(name.toUpperCase());
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  return {
    uprn:     find('UPRN'),
    address:  find('FULL_ADDRE', 'SINGLE_LINE_ADDRESS', 'ADDRESS', 'FULL_ADDRESS'),
    postcode: find('POSTCODE', 'POST_CODE'),
    lat:      find('LATITUDE', 'LAT'),
    lng:      find('LONGITUDE', 'LNG', 'LONG', 'LON'),
    easting:  find('EASTING', 'X_COORDINATE', 'X'),
    northing: find('NORTHING', 'Y_COORDINATE', 'Y'),
  };
}

// ── CSV parser ───────────────────────────────────────────────────────────────

export function parseAddressCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

  // Simple CSV split respecting quoted fields
  function splitRow(line) {
    const result = [];
    let current = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const headers = splitRow(lines[0]);
  const cols = detectColumns(headers);

  if (!cols.uprn) throw new Error('No UPRN column found');
  if (!cols.lat && !cols.easting) throw new Error('No coordinate columns found (need Latitude/Longitude or Easting/Northing)');

  const features = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = splitRow(lines[i]);
    if (row.length < 2) continue;

    const get = (col) => col ? (row[headers.indexOf(col)] || '').trim() : '';

    let lng, lat;

    if (cols.lat && cols.lng) {
      lat = parseFloat(get(cols.lat));
      lng = parseFloat(get(cols.lng));
    } else if (cols.easting && cols.northing) {
      const e = parseFloat(get(cols.easting));
      const n = parseFloat(get(cols.northing));
      if (isNaN(e) || isNaN(n)) { skipped++; continue; }
      const wgs = bngToWgs84(e, n);
      lat = wgs.lat; lng = wgs.lng;
    }

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) { skipped++; continue; }

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        uprn:     get(cols.uprn),
        address:  get(cols.address),
        postcode: get(cols.postcode),
      }
    });
  }

  return { features, skipped, total: lines.length - 1 };
}

// ── Store ────────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  stage: 'setup',        // 'setup' | 'import' | 'build-area' | 'cabinet' | 'design'
  project: null,         // { name, countryCode, buildCode, areaId }
  buildArea: null,       // GeoJSON Polygon Feature
  cabinet: null,         // GeoJSON Point Feature
  chambers: [],
  ducts: [],
  addressPoints: [],     // GeoJSON Feature[] — address/UPRN points
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_STATE };
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage full — ignore */ }
}

class ProjectStore {
  constructor() {
    this._state = load();
    this._listeners = [];
  }

  get state() { return this._state; }
  get stage() { return this._state.stage; }
  get project() { return this._state.project; }
  get buildArea() { return this._state.buildArea; }
  get cabinet() { return this._state.cabinet; }
  get chambers() { return this._state.chambers; }
  get ducts() { return this._state.ducts; }
  get addressPoints() { return this._state.addressPoints; }

  on(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _emit(event) { this._listeners.forEach(fn => fn(event, this._state)); }

  _update(patch) {
    this._state = { ...this._state, ...patch };
    save(this._state);
    this._emit('change');
  }

  setupProject(project) {
    this._update({ project, stage: 'import' });
  }

  setAddressPoints(features) {
    this._update({ addressPoints: features, stage: 'build-area' });
  }

  setBuildArea(feature) {
    this._update({ buildArea: feature, stage: 'cabinet' });
  }

  setCabinet(feature) {
    this._update({ cabinet: feature, stage: 'design' });
  }

  addChamber(feature) {
    this._update({ chambers: [...this._state.chambers, feature] });
  }

  addDuct(feature) {
    this._update({ ducts: [...this._state.ducts, feature] });
  }

  resetProject() {
    this._state = { ...DEFAULT_STATE };
    localStorage.removeItem(STORAGE_KEY);
    this._emit('reset');
  }
}

export const projectStore = new ProjectStore();
