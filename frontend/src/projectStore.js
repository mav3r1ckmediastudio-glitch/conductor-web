// projectStore.js — Central application state for Conductor Web
// Persists to localStorage on every change.
// Workflow stages: 'setup' → 'import' → 'build-area' → 'cabinet' → 'design'

import proj4 from 'proj4';
import { showError } from './toast.js';

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
  catch (e) {
    showError('Could not read your saved-projects list. It may not show recent projects until this is resolved.');
    return [];
  }
}
function writeIndex(list) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); }
  catch (e) { showError('Could not update your saved-projects list — this project may not appear in "Open" next time.'); }
}
function upsertIndex(id, state) {
  const list = readIndex();
  const i = list.findIndex(e => e.id === id);
  const prior = i >= 0 ? list[i] : null;
  const entry = {
    id,
    name:      state.project?.name   || 'Untitled',
    areaId:    state.project?.areaId || '',
    savedAt:   Date.now(),
    // fileBound/fileName are owned by fsaa.js via setFileBound(), not by this
    // save path — carry them forward so a normal autosave doesn't clobber them.
    fileBound: prior?.fileBound || false,
    fileName:  prior?.fileName  || null,
  };
  if (i >= 0) list[i] = entry; else list.push(entry);
  writeIndex(list);
}
// Drop a project's full localStorage blob, but only if it's confirmed to have
// a real .conductor file backing it (fileBound:true in the index). The index
// entry itself (name/area/date for the Open list) is kept regardless — this
// only removes the duplicated full state. Unbound projects are left alone:
// they have no other copy of their data, so full retention is their only
// safety net. Called whenever we switch away from a project (open a
// different one, or start a new one).
function evictBlobIfFileBound(id) {
  if (!id) return;
  const entry = readIndex().find(e => e.id === id);
  if (!entry?.fileBound) return;
  try { localStorage.removeItem(projectKey(id)); }
  catch (e) { console.error('[projectStore] could not evict blob for file-bound project:', e); }
}
// One-time migration: adopt the legacy single-project blob as the first indexed project.
// Console-only (not a toast): this runs invisibly once on first load for very old
// projects and there's nothing the user can do about a migration failure in the
// moment — but it should be diagnosable, not silently swallowed, if it ever fires.
function migrateLegacy() {
  if (readIndex().length) return;                    // already migrated
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch (e) { console.error('[projectStore] could not read legacy project for migration:', e); return; }
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    const id = newId();
    localStorage.setItem(projectKey(id), raw);
    upsertIndex(id, state);
    localStorage.setItem(ACTIVE_KEY, id);
    // legacy key intentionally left in place as a backup.
  } catch (e) { console.error('[projectStore] legacy project migration failed:', e); }
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

// ── Fibre-field backfill ───────────────────────────────────────────────────
// Spans and aerial drops gained inline fibre attributes (cable_type / fibre_count)
// so the fibre trace can treat them as cables/bundles. Assets drawn before that
// change have no such fields. This backfill stamps sensible defaults onto any
// span/drop missing them, so older projects become trace-able and the fields
// show up in the edit panel. Idempotent: only fills when absent, never overwrites
// a value the user has set. Returns true if anything changed (so the caller can
// persist the migrated state).
const SPAN_FIBRE_DEFAULTS  = { cable_type: 'AERIAL_SPAN', fibre_count: 96 };
const ADROP_FIBRE_DEFAULTS = { cable_type: 'AERIAL_DROP', fibre_count: 2 };

function backfillFibreFields(state) {
  let changed = false;

  const fill = (arr, defaults, aliasNodeType) => {
    if (!Array.isArray(arr)) return;
    for (const f of arr) {
      if (!f || !f.properties) continue;
      const p = f.properties;
      for (const [k, v] of Object.entries(defaults)) {
        if (p[k] === undefined || p[k] === null) { p[k] = v; changed = true; }
      }
      // Node-type aliases the trace BFS reads uniformly across cables + spans.
      if (p.from_node_type === undefined && p.from_type !== undefined) {
        p.from_node_type = p.from_type; changed = true;
      }
      if (p.to_node_type === undefined && p.to_type !== undefined) {
        p.to_node_type = p.to_type; changed = true;
      }
      // Aerial drops: the CBT end is the trace entry hop.
      if (aliasNodeType === 'adrop') {
        if (p.from_node === undefined && p.from_cbt !== undefined) {
          p.from_node = p.from_cbt; changed = true;
        }
        if (p.from_node_type === undefined) { p.from_node_type = 'CBT'; changed = true; }
      }
    }
  };

  fill(state.spans,       SPAN_FIBRE_DEFAULTS,  'span');
  fill(state.aerialDrops, ADROP_FIBRE_DEFAULTS, 'adrop');

  return changed;
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
  cbtTails: [],
  addressPoints: [],
  fibreAssignments: [],
};

function load() {
  try {
    migrateLegacy();
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id) {
      const raw = localStorage.getItem(projectKey(id));
      if (raw) {
        const state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        // Retro-fit fibre fields onto pre-existing spans/drops, then persist so
        // the migration only runs once per project.
        if (backfillFibreFields(state)) {
          try { localStorage.setItem(projectKey(id), JSON.stringify(state)); }
          catch (e) { showError('A background data update could not be saved — it will retry next time you open this project.'); }
        }
        return state;
      }
    }
  } catch (e) {
    showError('Could not load your saved project from local storage. Starting with a blank project — your data may still be recoverable from a .conductor file if you saved one.');
  }
  return { ...DEFAULT_STATE };
}

function save(state) {
  try {
    let id = localStorage.getItem(ACTIVE_KEY);
    if (!id) { id = newId(); localStorage.setItem(ACTIVE_KEY, id); }
    localStorage.setItem(projectKey(id), JSON.stringify(state));
    upsertIndex(id, state);
  } catch (e) {
    // This is the local crash-cache write, not your primary save. If a
    // .conductor file is bound, FSAA (fsaa.js) still has the durable copy and
    // shows its own status indicator — this failure means the *backup* layer
    // is degraded, which still matters (e.g. if the tab crashes before the
    // next autosave) but isn't a sign you've lost your work outright.
    showError('Local backup save failed (storage may be full). If you have a project file open, your work is still safe there — otherwise, save a .conductor file now as a precaution.');
  }
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
  get cbtTails()      { return this._state.cbtTails || []; }
  get addressPoints() { return this._state.addressPoints; }
  get fibreAssignments() { return this._state.fibreAssignments || []; }

  on(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _emit(event, extra) { this._listeners.forEach(fn => fn(event, this._state, extra)); }

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

  addCBTTail(feature) {
    this._update({ cbtTails: [...(this._state.cbtTails || []), feature] });
  }

  // ── Asset mutation helpers (used by Edit / Move / Delete tools) ───────────
  // collection: 'chambers' | 'ducts' | 'joints' | 'dropDucts' | 'cables' |
  //             'bundles' | 'poles' | 'cbts' | 'spans' | 'aerialDrops' | 'cbtTails'
  // index: numeric index into that array

  updateAsset(collection, index, newProps) {
    const arr = this._state[collection];
    if (!arr || index < 0 || index >= arr.length) return;
    const updated = arr.slice();
    updated[index] = { ...updated[index], properties: { ...updated[index].properties, ...newProps } };
    this._update({ [collection]: updated });
  }

  updateAssetGeometry(collection, index, newCoords) {
    const arr = this._state[collection];
    if (!arr || index < 0 || index >= arr.length) return;
    const updated = arr.slice();
    updated[index] = { ...updated[index], geometry: { ...updated[index].geometry, coordinates: newCoords } };
    this._update({ [collection]: updated });
  }

  deleteAsset(collection, index) {
    const arr = this._state[collection];
    if (!arr || index < 0 || index >= arr.length) return;
    const updated = arr.slice();
    updated.splice(index, 1);
    this._update({ [collection]: updated });
  }

  // ── Fibre assignment ───────────────────────────────────────────────────────
  // Apply the result of fibreAssign.assignFibres():
  //   • write splitter_port onto each consumer (aerial drops + bundles)
  //   • write feeder_port onto each child splitter (joints/cbts)
  //   • write the splitter summary (has_splitter/split_ratio/fibre_in/fibre_out)
  //     onto each splitter joint/cbt
  //   • store the assignment records
  // One atomic _update so the map re-syncs once and it persists in a single write.
  applyFibreAssignment(result) {
    if (!result || !result.ok) return;

    const patch = {};

    // 1. Consumer ports — key is 'collection:assetId'.
    const portFor = (collection, idField) => {
      const arr = this._state[collection];
      if (!Array.isArray(arr)) return null;
      let touched = false;
      const next = arr.map(f => {
        const id = f.properties?.[idField];
        if (id == null) return f;
        const key = `${collection}:${id}`;
        if (Object.prototype.hasOwnProperty.call(result.consumerPorts, key)) {
          touched = true;
          return { ...f, properties: { ...f.properties, splitter_port: result.consumerPorts[key] } };
        }
        return f;
      });
      return touched ? next : null;
    };
    const drops   = portFor('aerialDrops', 'adrop_id');
    const bundles = portFor('bundles', 'bundle_id');
    if (drops)   patch.aerialDrops = drops;
    if (bundles) patch.bundles = bundles;

    // 2. Splitter summary + feeder_port onto joints and cbts.
    const applySummary = (collection, idField) => {
      const arr = this._state[collection];
      if (!Array.isArray(arr)) return null;
      let touched = false;
      const next = arr.map(f => {
        const id = String(f.properties?.[idField]);
        const summary = result.splitterSummary[id];
        const feederPort = result.splitterPorts[id];
        if (!summary && feederPort === undefined) return f;
        touched = true;
        const add = { ...(summary || {}) };
        if (feederPort !== undefined) add.feeder_port = feederPort;
        return { ...f, properties: { ...f.properties, ...add } };
      });
      return touched ? next : null;
    };
    const joints = applySummary('joints', 'joint_id');
    const cbts   = applySummary('cbts', 'cbt_id');
    if (joints) patch.joints = joints;
    if (cbts)   patch.cbts = cbts;

    // 3. Assignment records.
    patch.fibreAssignments = result.assignments || [];

    this._update(patch);
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
    try { return localStorage.getItem(ACTIVE_KEY); }
    catch (e) { console.error('[projectStore] could not read active project id:', e); return null; }
  }

  // Called by fsaa.js whenever a project's file-binding changes (bound on
  // saveAs/openFile/resume, unbound via the explicit unbindFile action, or
  // cleared automatically if a stale handle fails to load). Lightweight index
  // update only — never touches the full project blob.
  setFileBound(id, bound, fileName) {
    if (!id) return;
    const list = readIndex();
    const i = list.findIndex(e => e.id === id);
    if (i < 0) return;   // project not indexed (shouldn't happen) — nothing to flag
    list[i] = { ...list[i], fileBound: !!bound, fileName: bound ? (fileName || null) : null };
    writeIndex(list);
  }

  // NOTE: failures here return { ok: false } and are surfaced by the caller
  // (App.svelte shows "Could not open that project." on a falsy ok) — kept as
  // console.error here, not a toast, to avoid showing the user two messages
  // for the same failure.
  //
  // Returns one of:
  //   { ok: true }                                     — loaded from localStorage as normal
  //   { ok: false, needsFileResume: true, fileName }    — no cached blob, but this
  //                                                        project has a bound .conductor
  //                                                        file; caller should call
  //                                                        fsaa.resumeProjectFile(id)
  //   { ok: false }                                     — genuinely could not open
  openProject(id) {
    const prevId = this.activeId();
    if (prevId && prevId !== id) evictBlobIfFileBound(prevId);

    let raw;
    try { raw = localStorage.getItem(projectKey(id)); }
    catch (e) { console.error('[projectStore] could not read project for open:', e); return { ok: false }; }

    if (raw) {
      try {
        localStorage.setItem(ACTIVE_KEY, id);
        this._state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
        if (backfillFibreFields(this._state)) save(this._state);
        this._emit('reset');
        return { ok: true };
      } catch (e) { console.error('[projectStore] failed to open project:', e); return { ok: false }; }
    }

    // No cached blob. If this project has a confirmed file binding, its
    // localStorage copy was deliberately evicted, not lost — the .conductor
    // file is the real copy. Point the active id at it now (so a subsequent
    // fsaa.resumeProjectFile() writes/persists under the right key) and hand
    // back to the caller to re-grant file permission, which needs a user
    // gesture this function call may not have.
    const entry = readIndex().find(e => e.id === id);
    if (entry?.fileBound) {
      try { localStorage.setItem(ACTIVE_KEY, id); }
      catch (e) { console.error('[projectStore] could not set active id for file resume:', e); }
      this._state = { ...DEFAULT_STATE };
      this._emit('reset');
      return { ok: false, needsFileResume: true, fileName: entry.fileName };
    }

    return { ok: false };
  }

  // Replace the entire working state from an external source — i.e. a .conductor
  // file opened via the File System Access API (see fsaa.js). Mirrors
  // openProject() but takes a parsed state object instead of a localStorage id.
  // Still writes through to localStorage so the in-browser cache and the project
  // index stay coherent. Emits 'reset' so the map + UI re-sync.
  loadExternalState(state) {
    this._state = { ...DEFAULT_STATE, ...(state || {}) };
    backfillFibreFields(this._state);
    save(this._state);
    this._emit('reset');
  }

  // Start a brand-new project. The current project stays saved under its own id.
  newProject() {
    const prevId = this.activeId();
    if (prevId) evictBlobIfFileBound(prevId);
    const id = newId();
    try { localStorage.setItem(ACTIVE_KEY, id); }
    catch (e) { showError('Could not set this as your active project — it may not reopen automatically next time.'); }
    this._state = { ...DEFAULT_STATE };
    save(this._state);          // create the project key + index entry immediately
    this._emit('reset');
  }

  deleteProject(id) {
    try {
      localStorage.removeItem(projectKey(id));
      writeIndex(readIndex().filter(e => e.id !== id));
      if (this.activeId() === id) localStorage.removeItem(ACTIVE_KEY);
    } catch (e) { showError('Could not fully delete that project — it may still appear in your project list.'); }
    // Let fsaa.js drop any stored file handle for this project, whether or
    // not the deletion above fully succeeded.
    this._emit('project-deleted', id);
  }

  resetProject() {
    // Clears the *current* project in place (keeps it as the active id).
    this._state = { ...DEFAULT_STATE };
    save(this._state);
    this._emit('reset');
  }
}

export const projectStore = new ProjectStore();
