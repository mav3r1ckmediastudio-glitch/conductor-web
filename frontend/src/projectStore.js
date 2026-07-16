// projectStore.js — Central application state for Conductor Web
// Persists to localStorage on every change.
// Workflow stages: 'setup' → 'import' → 'build-area' → 'cabinet' → 'design'

import proj4 from 'proj4';
import { showError, showToast } from './toast.js';
import { computeCascadeDelete } from './cascadeDelete.js';
import { analyseProject, repairProject } from './repairProject.js';
import { validateProjectState, stampVersion } from './projectSchema.js';
import { hashPhysicalPlanInputs } from './fibrePlanInputs.js';

// Set by vite.config.js's `define` from package.json — see that file for
// why. Guarded for any code path that imports this module outside the
// vite/vitest pipeline (that global wouldn't be replaced there).
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

// Turn a validateProjectState() warnings list into one toast message. Kept
// short (first 3 + a count) — the point is "something was silently unusable
// and got dropped, go check your file," not a full diagnostic dump in a
// toast.
function warnAboutRepairs(warnings, context) {
  if (!warnings.length) return;
  const shown = warnings.slice(0, 3).join(' ');
  const more = warnings.length > 3 ? ` (+${warnings.length - 3} more)` : '';
  showToast(`${context} needed repair: ${shown}${more}`, { type: 'warning', duration: 9000 });
}

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
  physicalAssignments: [],
  physicalPlanInputHash: null,
  // Trust marker for the PHYSICAL fibre plan (through-splices / dark storage).
  // 'UNVERIFIED' until the demand-driven physical planner has produced a plan
  // that passes every invariant; only a validated planner run sets 'VALIDATED'.
  // Logical splitter-port allocation is unaffected by this flag.
  physicalPlanStatus: 'UNVERIFIED',
};

function load() {
  try {
    migrateLegacy();
    const id = localStorage.getItem(ACTIVE_KEY);
    if (id) {
      const raw = localStorage.getItem(projectKey(id));
      if (raw) {
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch (e) {
          showError('Your saved project data was corrupted and could not be read. Starting with a blank project — check for a .conductor file backup if you have one.');
          return { ...DEFAULT_STATE };
        }
        const result = validateProjectState(parsed);
        if (!result.ok) {
          console.error('[projectStore] saved project failed validation:', result.errors);
          showError('Your saved project could not be loaded (' + result.errors.join(' ') + '). Starting with a blank project — your data is still on disk under this browser\'s storage and has not been deleted.');
          return { ...DEFAULT_STATE };
        }
        warnAboutRepairs(result.warnings, 'Your saved project');
        if (result.migrations && result.migrations.length) {
          showToast(result.migrations[0], { type: 'warning', duration: 12000 });
        }
        const state = { ...DEFAULT_STATE, ...result.state };
        // Retro-fit fibre fields onto pre-existing spans/drops, then persist so
        // the migration only runs once per project.
        if (backfillFibreFields(state)) {
          try { localStorage.setItem(projectKey(id), JSON.stringify(stampVersion(state, APP_VERSION))); }
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
    stampVersion(state, APP_VERSION);
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

// ── Debounced persistence ────────────────────────────────────────────
// save() above is the heavy write: JSON.stringify of the WHOLE project plus a
// localStorage write. Doing that synchronously on every single asset mutation
// makes building a large network O(n^2) — the main autosave cost on big designs.
// We coalesce it: frequent edits (add/move/edit/delete of assets) schedule a
// write a few hundred ms later, so a burst of actions produces ONE write instead
// of hundreds. A pending write is ALWAYS flushed synchronously before we switch
// project and before the tab is hidden/closed, so nothing is ever lost. Low-
// frequency structural changes (project setup, stage transitions, open/new/
// restore) still write immediately via _updateNow()/flushSave(). The active-
// project pointer (ACTIVE_KEY) and the index keep their own immediate writes,
// so "reopen the last project on startup" is completely unaffected.
const SAVE_DEBOUNCE_MS = 400;
let _saveTimer = null;
let _pendingState = null;

function scheduleSave(state) {
  _pendingState = state;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; flushSave(); }, SAVE_DEBOUNCE_MS);
  // Don't let a queued autosave keep a Node process (e.g. tests) alive.
  if (_saveTimer && typeof _saveTimer.unref === 'function') _saveTimer.unref();
}

// Write any coalesced state to localStorage right now. Safe to call anytime;
// a no-op when nothing is pending.
function flushSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_pendingState) { const s = _pendingState; _pendingState = null; save(s); }
}

// Never let a coalesced write outlive the tab. pagehide covers close / navigate
// away / mobile backgrounding; visibilitychange→hidden covers desktop tab
// switches. Guarded so it's a no-op in non-browser environments (e.g. tests).
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSave();
  });
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
  get physicalPlanStatus() { return this._state.physicalPlanStatus || 'UNVERIFIED'; }
  get physicalAssignments() { return this._state.physicalAssignments || []; }
  get physicalPlanInputHash() { return this._state.physicalPlanInputHash || null; }

  on(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(l => l !== fn); }; }
  _emit(event, extra) { this._listeners.forEach(fn => fn(event, this._state, extra)); }

  // Frequent mutations (asset add / edit / move / delete). Debounced write.
  _update(patch) {
    this._state = { ...this._state, ...patch };
    scheduleSave(this._state);
    this._emit('change');
  }

  // Low-frequency structural changes that callers/tests expect on disk right
  // away (project setup, stage transitions). Immediate write.
  _updateNow(patch) {
    this._state = { ...this._state, ...patch };
    _pendingState = this._state;
    flushSave();
    this._emit('change');
  }

  _save() {
    _pendingState = this._state;
    flushSave();
  }

  // Public: force any coalesced autosave to disk now. Wired to tab hide/close
  // above; also available to callers before a risky operation.
  flush() {
    _pendingState = this._state;
    flushSave();
  }

  // Stamp schema/app version onto the live state and return it. Used by
  // fsaa.js's .conductor file write path, which serializes
  // projectStore.state directly rather than going through save() above
  // (that writes to localStorage, not a file) — this keeps both write
  // paths stamping the same version fields via the same helper.
  stampForSave() {
    stampVersion(this._state, APP_VERSION);
    return this._state;
  }

  setupProject(project) {
    this._updateNow({ project, stage: 'import' });
  }

  setAddressPoints(features) {
    this._updateNow({ addressPoints: features, stage: 'build-area' });
  }

  setBuildArea(feature) {
    this._updateNow({ buildArea: feature, stage: 'cabinet' });
  }

  setCabinet(feature) {
    this._updateNow({ cabinet: feature, stage: 'design' });
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

  // Deletes the asset AND cascades cleanup to every dependent record that
  // referenced it — see cascadeDelete.js for the full rules. Previously this
  // just spliced the target out and left every dependent (cables/spans with
  // it as an endpoint, bundles/aerial drops hung off it, fibre assignments
  // naming it) pointing at a dead ID forever; those dangling references only
  // ever surfaced later as "Broken connectivity" errors in Design Health,
  // with no way to clear them short of hand-editing the saved project file.
  //
  // Returns a summary of what else was touched — { removed, nulled }, each
  // keyed by collection — so the caller can tell the user what happened
  // instead of the deletion silently rippling elsewhere unannounced.
  deleteAsset(collection, index) {
    const result = computeCascadeDelete(this._state, collection, index);
    if (!result) return null;
    this._update(result.patch);
    return result.summary;
  }

  // ── Project repair (one-time cleanup of pre-existing dangling refs) ─────────
  // See repairProject.js. Two-step by design: analyseRepair() is a DRY RUN
  // (computes what would change, mutates nothing) so the UI can show the user
  // a preview before anything destructive happens; applyRepair() then commits
  // it. Needed because cascadeDelete only prevents NEW dangling refs — projects
  // saved before that fix can still carry old ones (e.g. the 402 fibre
  // assignments found on SCOT-PH1 from a long-since-deleted pole).

  // Dry run — returns { clean, passes, removed, nulled, total }. No mutation.
  analyseRepair() {
    return analyseProject(this._state);
  }

  // Applies the repair and returns the same summary shape. A clean project
  // produces an empty patch and is left untouched.
  applyRepair() {
    const { patch, summary } = repairProject(this._state);
    if (summary.total > 0) this._update(patch);
    return summary;
  }

  // ── Session snapshot / restore ─────────────────────────────────────────────
  // Used by continuous tool sessions (see startToolSession() in mapTools.js).
  // Full-state deep clone/restore rather than tracking and inverting each
  // individual add/update/delete — simpler and safer than reconstructing a
  // precise undo log, at the minor cost of also rolling back anything
  // unrelated that happened to change mid-session. Acceptable given a
  // session is a short, single-purpose interaction (place/edit/delete/move
  // a run of assets, then Save or Cancel).

  snapshotState() {
    // structuredClone: native, ~2x faster than a JSON round-trip on large
    // projects, identical result for the JSON-safe state we persist.
    return structuredClone(this._state);
  }

  restoreState(snapshot) {
    this._state = snapshot;
    _pendingState = this._state;
    flushSave();
    this._emit('change');
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

    // 3. Assignment records + physical-plan trust marker (release-audit P0-1).
    // The port/summary writes above (steps 1–2) are always applied — trusted
    // logical allocation. The RECORDS are the physical plan and follow the
    // planner's own verdict for THIS run. Automated validation is NOT human
    // approval: a run that does not validate always makes the current status
    // INVALID/UNVERIFIED and clears the physical plan — a previously validated
    // plan is never silently preserved through a topology change.
    const runStatus = result.physicalPlanStatus || 'UNVERIFIED';
    patch.fibreAssignments = result.assignments || [];
    if (runStatus === 'VALIDATED') {
      patch.physicalAssignments = result.physicalAssignments || [];
      patch.physicalPlanStatus = 'VALIDATED';
    } else {
      // Not validated → nothing physical is authoritative for the current state.
      patch.physicalAssignments = [];
      patch.physicalPlanStatus = runStatus;
    }

    // Stamp the input fingerprint over the RESULTING state (post-writeback) so a
    // freshly saved plan reads back as current, and any later edit to a planning
    // input makes stored !== current and closes the export gate. Only meaningful
    // for a validated plan; cleared otherwise.
    if (runStatus === 'VALIDATED') {
      const nextState = { ...this._state, ...patch };
      patch.physicalPlanInputHash = hashPhysicalPlanInputs(nextState);
    } else {
      patch.physicalPlanInputHash = null;
    }

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
    flushSave();   // persist the outgoing project's coalesced edits before we switch id
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
  // Validates the incoming object first (projectSchema.js) rather than the
  // previous blind `{ ...DEFAULT_STATE, ...state }` merge — a malformed or
  // future-schema file is REJECTED (this._state left untouched) instead of
  // silently becoming the live project. Returns a report instead of
  // throwing: fsaa.js's loadFromHandle() is mid-way through binding a file
  // handle when this runs and needs to decide what "invalid" means for that
  // context itself (compose its own Error, still reset its own in-flight
  // flags) rather than have control ripped away by an exception here.
  loadExternalState(state) {
    const result = validateProjectState(state);
    if (!result.ok) {
      return { ok: false, errors: result.errors, warnings: [] };
    }
    this._state = { ...DEFAULT_STATE, ...result.state };
    backfillFibreFields(this._state);
    _pendingState = this._state;
    flushSave();
    this._emit('reset');
    if (result.migrations && result.migrations.length) {
      showToast(result.migrations[0], { type: 'warning', duration: 12000 });
    }
    return { ok: true, errors: [], warnings: result.warnings, migrations: result.migrations || [] };
  }

  // Start a brand-new project. The current project stays saved under its own id.
  newProject() {
    flushSave();   // persist the outgoing project's coalesced edits before we switch id
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
    flushSave();   // no queued autosave should fire after we remove the blob below
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
    _pendingState = this._state;
    flushSave();
    this._emit('reset');
  }
}

export const projectStore = new ProjectStore();
