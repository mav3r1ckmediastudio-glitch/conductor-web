// fsaa.js — File System Access API persistence for Conductor Web.
//
// Gives a project a real `.conductor` file on the user's disk with in-place
// autosave (debounced, on every store change), plus resume-on-relaunch via an
// IndexedDB-persisted file handle. This is the durable, user-owned store; the
// existing localStorage layer keeps running underneath as a crash cache.
//
// Target: Windows / Chromium (Chrome, Edge). Where the API is absent,
// isSupported() returns false and the UI should hide the File buttons.
//
// Public API:
//   isSupported()        → boolean
//   onStatus(fn)         → subscribe to {status,lastSaved,fileName,supported}; returns unsubscribe
//   getStatus()          → current snapshot
//   saveAs()             → pick a new file, bind it, write now           (user gesture)
//   openFile()           → pick an existing file, load + bind it         (user gesture)
//   saveNow()            → flush a pending write immediately
//   tryResume()          → silent re-open of last file IF perm already granted (call on mount)
//   resumePrompt()       → re-grant permission + load (call from a click) (user gesture)
//   unbindFile()         → detach the current file (stops file autosave)
//
// status values: 'no-file' | 'saved' | 'saving' | 'unsaved' | 'error'

import { projectStore } from './projectStore.js';

const FILE_EXT    = '.conductor';
const FILE_DESC   = 'Conductor Web project';
const MIME        = 'application/json';
const DEBOUNCE_MS = 1200;

// ── feature detection ────────────────────────────────────────────────────────
export function isSupported() {
  return typeof window !== 'undefined'
    && 'showSaveFilePicker' in window
    && 'showOpenFilePicker' in window;
}

// ── status emitter (drives the save indicator in App.svelte) ─────────────────
let _status    = 'no-file';
let _lastSaved = null;   // epoch ms of last successful disk write
let _fileName  = null;   // current bound file name, for display
const _subs = [];

function snapshot() {
  return { status: _status, lastSaved: _lastSaved, fileName: _fileName, supported: isSupported() };
}
function setStatus(s, extra = {}) {
  _status = s;
  if ('lastSaved' in extra) _lastSaved = extra.lastSaved;
  if ('fileName'  in extra) _fileName  = extra.fileName;
  const snap = snapshot();
  _subs.forEach(fn => { try { fn(snap); } catch (_) {} });
}
export function onStatus(fn) {
  _subs.push(fn);
  fn(snapshot());
  return () => { const i = _subs.indexOf(fn); if (i >= 0) _subs.splice(i, 1); };
}
export function getStatus() { return snapshot(); }

// ── IndexedDB: persist the FileSystemFileHandle across sessions ───────────────
// File handles are structured-cloneable, so they store directly in IndexedDB.
const IDB_NAME  = 'conductor_fsaa';
const IDB_STORE = 'handles';
const IDB_KEY   = 'active';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function idbPut(handle) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function idbGet() {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r  = tx.objectStore(IDB_STORE).get(IDB_KEY);
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}
async function idbClear() {
  try {
    const db = await idb();
    await new Promise((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => res();
      tx.onerror    = () => res();
    });
  } catch (_) { /* ignore */ }
}

// ── core write logic ─────────────────────────────────────────────────────────
let _handle  = null;    // current FileSystemFileHandle (null = no file bound)
let _writing = false;
let _pending = false;   // a write was requested while one was in flight
let _timer   = null;
let _suppressResetDetach = false;   // true while we ourselves are loading a file
let _pendingResumeHandle = null;    // handle awaiting a user-gesture re-grant

async function writeNow() {
  if (!_handle) return;
  if (_writing) { _pending = true; return; }   // coalesce overlapping writes
  _writing = true;
  setStatus('saving');
  try {
    const json = JSON.stringify(projectStore.state);
    const w = await _handle.createWritable();
    await w.write(json);
    await w.close();
    setStatus('saved', { lastSaved: Date.now() });
  } catch (e) {
    console.error('[fsaa] write failed:', e);
    setStatus('error');
  } finally {
    _writing = false;
    if (_pending) { _pending = false; writeNow(); }
  }
}

function scheduleWrite() {
  if (!_handle) return;
  setStatus('unsaved');
  clearTimeout(_timer);
  _timer = setTimeout(writeNow, DEBOUNCE_MS);
}

async function detach() {
  clearTimeout(_timer);
  _handle = null;
  _pendingResumeHandle = null;
  await idbClear();
  setStatus('no-file', { lastSaved: null, fileName: null });
}

function suggestName() {
  const p = projectStore.project;
  const base = (p?.areaId || p?.name || 'conductor-project')
    .toString().trim().replace(/[^\w.-]+/g, '_') || 'conductor-project';
  return base + FILE_EXT;
}

async function loadFromHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  let state;
  try { state = JSON.parse(text); }
  catch { throw new Error('That file is not a valid Conductor project.'); }

  _suppressResetDetach = true;
  projectStore.loadExternalState(state);   // emits 'reset'
  _suppressResetDetach = false;

  _handle = handle;
  await idbPut(handle);
  setStatus('saved', { lastSaved: Date.now(), fileName: handle.name });
}

// ── public actions ───────────────────────────────────────────────────────────

// Bind the current project to a NEW file on disk and write it immediately.
export async function saveAs() {
  if (!isSupported()) throw new Error('File System Access API not available in this browser.');
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: suggestName(),
      types: [{ description: FILE_DESC, accept: { [MIME]: [FILE_EXT] } }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return false;   // user cancelled
    throw e;
  }
  _handle = handle;
  _pendingResumeHandle = null;
  await idbPut(handle);
  setStatus('saving', { fileName: handle.name });
  await writeNow();
  return true;
}

// Pick an existing .conductor file, load it into the store, and bind it.
export async function openFile() {
  if (!isSupported()) throw new Error('File System Access API not available in this browser.');
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: FILE_DESC, accept: { [MIME]: [FILE_EXT, '.json'] } }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return false;   // user cancelled
    throw e;
  }
  await loadFromHandle(handle);
  return true;
}

// Flush any pending debounced write right now (e.g. Ctrl+S, or before quit).
export async function saveNow() {
  if (!_handle) return false;
  clearTimeout(_timer);
  await writeNow();
  return true;
}

// Detach the current file. Autosave-to-file stops; localStorage keeps the data.
export async function unbindFile() {
  await detach();
}

// On app mount: silently re-open the last file IF permission is still granted.
// Returns { state: 'granted'|'prompt'|'none', fileName? }.
//   'granted' → already loaded, nothing more to do.
//   'prompt'  → a file exists but needs a user click to re-grant; show a
//               "Resume <fileName>" button that calls resumePrompt().
//   'none'    → nothing to resume.
export async function tryResume() {
  if (!isSupported()) return { state: 'none' };
  let handle;
  try { handle = await idbGet(); } catch { return { state: 'none' }; }
  if (!handle) return { state: 'none' };

  let perm;
  try { perm = await handle.queryPermission({ mode: 'readwrite' }); }
  catch { return { state: 'none' }; }

  if (perm === 'granted') {
    try {
      await loadFromHandle(handle);
      return { state: 'granted', fileName: handle.name };
    } catch (e) {
      console.error('[fsaa] silent resume failed:', e);
      await idbClear();
      return { state: 'none' };
    }
  }

  // 'prompt' / 'denied' — re-granting needs a user gesture, so defer to a button.
  _pendingResumeHandle = handle;
  setStatus('no-file', { fileName: handle.name });
  return { state: 'prompt', fileName: handle.name };
}

// Call from a click handler to re-grant permission and load the deferred file.
export async function resumePrompt() {
  const handle = _pendingResumeHandle;
  if (!handle) return false;
  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;
    await loadFromHandle(handle);
    _pendingResumeHandle = null;
    return true;
  } catch (e) {
    console.error('[fsaa] resume prompt failed:', e);
    return false;
  }
}

// ── wire into the store, once, at import time ────────────────────────────────
projectStore.on((event) => {
  if (event === 'change') {
    scheduleWrite();
  } else if (event === 'reset') {
    // A reset we didn't trigger means the user switched/started a project via the
    // legacy localStorage switcher. The bound file belongs to the *previous*
    // project, so unbind it to avoid overwriting File A with Project B's data.
    if (_suppressResetDetach) return;
    detach();
  }
});
