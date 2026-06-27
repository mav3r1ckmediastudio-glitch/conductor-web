// projectStore.js — Central application state for Conductor Web
// Persists to localStorage on every change.
// Workflow stages: 'setup' → 'import' → 'build-area' → 'cabinet' → 'design'

import proj4 from 'proj4';

// EPSG:27700 (OSGB36 / British National Grid) → EPSG:4326 (WGS84).
// Includes the +towgs84 7-parameter datum shift, so output matches QGIS's
// 27700→4326 reprojection (sub-2m). This is the datum step the old hand-rolled
// Airy-ellipsoid transform was missing, which left points ~tens of metres off.
proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs'
);

const STORAGE_KEY  = 'conductor_web_project';        // legacy single-project key (migrated, kept as backup)
const INDEX_KEY    = 'conductor_web_index';          // [{ id, name, areaId, savedAt }]
const ACTIVE_KEY   = 'conductor_web_active';         // id of currently-open project
const projectKey   = (id) => `conductor_web_project_${id}`;

function newId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || []; }
  catch { return []; }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}
function upsertIndex(id, state) {
  const list = readIndex();
  const entry = {
    id,
    name:    state.project?.name   || 'Untitled',
    areaId:  state.project?.areaId || '',
    savedAt: Date.now(),
  };
  const i = list.findIndex(e => e.id === id);
  if (i >= 0) list[i] = entry; else list.push(entry);
  writeIndex(list);
}
// One-time migration: adopt the legacy single-project blob as the first indexed project.
function migrateLegacy() {
  if (readIndex().length) return;                    // already migrated
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    const id = newId();
    localStorage.setItem(projectKey(id), raw);
    upsertIndex(id, state);
    localStorage.setItem(ACTIVE_KEY, id);
    // legacy key intentionally left in place as a backup.
  } catch (e) { /* ignore */ }
}

// ── BNG (EPSG:27700) → WGS84 (EPSG:4326) conversion via proj4 ────────────────
// Same reprojection QGIS uses. Returns { lat, lng } in WGS84 degrees.
function bngToWgs84(easting, northing) {
  const [lng, lat] = proj4('EPSG:27700', 'EPSG:4326', [easting, northing]);
  return { lat, lng };
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
    uprn:      find('UPRN'),
    address:   find('FULL_ADDRE', 'SINGLE_LINE_ADDRESS', 'ADDRESS', 'FULL_ADDRESS'),
    postcode:  find('POSTCODE', 'POST_CODE'),
    lat:       find('LATITUDE', 'LAT'),
    lng:       find('LONGITUDE', 'LNG', 'LONG', 'LON'),
    easting:   find('EASTING', 'X_COORDINATE', 'X'),
    northing:  find('NORTHING', 'Y_COORDINATE', 'Y'),
    primaryCl: find('PRIMARY_CL', 'CLASSIFICATION_CODE', 'CLASS_CODE'),
    blpuState: find('BLPU_STATE', 'BLPU_STA_1', 'STATE'),
  };
}

// ── CSV parser ───────────────────────────────────────────────────────────────

export function parseAddressCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');

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

    // Filter out non-premises: keep only In Use (BLPU_STATE=2) Residential,
    // Commercial, Miscellaneous, and Military records. Discard Parent Shells (P),
    // Land/Street records (L), and anything not currently in use.
    if (cols.blpuState) {
      const state = parseInt(get(cols.blpuState), 10);
      if (state !== 2) { skipped++; continue; }
    }
    if (cols.primaryCl) {
      const cl = get(cols.primaryCl);
      if (!['R', 'C', 'Z', 'M'].includes(cl)) { skipped++; continue; }
    }

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
  stage: 'setup',
  project: null,
  buildArea: null,
  cabinet: null,
  chambers: [],
  ducts: [],
  joints: [],
  dropDucts: [],
  cables: [],
  bundles: [],
  poles: [],
  cbts: [],
  spans: [],
  aerialDrops: [],
  addressPoints: [],
};

function load() {
  try {
    migrateLegacy();
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id) {
      const raw = localStorage.getItem(projectKey(id));
      if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_STATE };
}

function save(state) {
  try {
    let id = localStorage.getItem(ACTIVE_KEY);
    if (!id) { id = newId(); localStorage.setItem(ACTIVE_KEY, id); }
    localStorage.setItem(projectKey(id), JSON.stringify(state));
    upsertIndex(id, state);
  } catch (e) { /* storage full — ignore */ }
}

class ProjectStore {
  constructor() {
    this._state = load();
    this._listeners = [];
  }

  get state()         { return this._state; }
  get stage()         { return this._state.stage; }
  get project()       { return this._state.project; }
  get buildArea()     { return this._state.buildArea; }
  get cabinet()       { return this._state.cabinet; }
  get chambers()      { return this._state.chambers; }
  get ducts()         { return this._state.ducts; }
  get joints()        { return this._state.joints; }
  get dropDucts()     { return this._state.dropDucts; }
  get cables()        { return this._state.cables; }
  get bundles()       { return this._state.bundles; }
  get poles()         { return this._state.poles; }
  get cbts()          { return this._state.cbts; }
  get spans()         { return this._state.spans; }
  get aerialDrops()   { return this._state.aerialDrops || []; }
  get addressPoints() { return this._state.addressPoints; }

  on(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _emit(event) { this._listeners.forEach(fn => fn(event, this._state)); }

  _update(patch) {
    this._state = { ...this._state, ...patch };
    save(this._state);
    this._emit('change');
  }

  _save() {
    save(this._state);
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

  addJoint(feature) {
    this._update({ joints: [...this._state.joints, feature] });
  }

  addDropDuct(feature) {
    this._update({ dropDucts: [...this._state.dropDucts, feature] });
  }

  addCable(feature) {
    this._update({ cables: [...this._state.cables, feature] });
  }

  addBundle(feature) {
    this._update({ bundles: [...this._state.bundles, feature] });
  }

  addPole(feature) {
    this._update({ poles: [...this._state.poles, feature] });
  }

  addCBT(feature) {
    this._update({ cbts: [...this._state.cbts, feature] });
  }

  addSpan(feature) {
    this._update({ spans: [...this._state.spans, feature] });
  }

  addAerialDrop(feature) {
    this._update({ aerialDrops: [...(this._state.aerialDrops || []), feature] });
  }

  updateChamberFunction(chamberId, newFunction) {
    const updated = this._state.chambers.map(ch => {
      if (ch.properties.chamber_id === chamberId) {
        return { ...ch, properties: { ...ch.properties, chamber_type: newFunction } };
      }
      return ch;
    });
    this._update({ chambers: updated });
  }

  // ── Multi-project management ───────────────────────────────────────────────

  listProjects() {
    return readIndex().sort((a, b) => b.savedAt - a.savedAt);
  }

  activeId() {
    try { return localStorage.getItem(ACTIVE_KEY); } catch (e) { return null; }
  }

  openProject(id) {
    let raw;
    try { raw = localStorage.getItem(projectKey(id)); } catch (e) { return false; }
    if (!raw) return false;
    try {
      localStorage.setItem(ACTIVE_KEY, id);
      this._state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
      this._emit('reset');
      return true;
    } catch (e) { return false; }
  }

  // Start a brand-new project. The current project stays saved under its own id.
  newProject() {
    const id = newId();
    try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* ignore */ }
    this._state = { ...DEFAULT_STATE };
    save(this._state);          // create the project key + index entry immediately
    this._emit('reset');
  }

  deleteProject(id) {
    try {
      localStorage.removeItem(projectKey(id));
      writeIndex(readIndex().filter(e => e.id !== id));
      if (this.activeId() === id) localStorage.removeItem(ACTIVE_KEY);
    } catch (e) { /* ignore */ }
  }

  resetProject() {
    // Clears the *current* project in place (keeps it as the active id).
    this._state = { ...DEFAULT_STATE };
    save(this._state);
    this._emit('reset');
  }
}

export const projectStore = new ProjectStore();
