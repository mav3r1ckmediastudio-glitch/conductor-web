// fsaa.js — File System Access API persistence for Conductor Web.
//
// Gives a project a real `.conductor` file on the user's disk with in-place
// autosave (debounced, on every store change), plus resume-on-relaunch via an
// IndexedDB-persisted file handle. This is the durable, user-owned store.
//
// localStorage is a crash-cache, NOT a second permanent copy: for the project
// currently open, it still mirrors full state on every change (so a tab crash
// before the next debounced file write isn't a total loss). But once a project
// is bound to a real .conductor file and you switch away from it, its full
// localStorage blob is evicted (see projectStore.js's evictBlobIfFileBound) —
// the file on disk is the durable copy, localStorage doesn't need to duplicate
// it forever. Unbound projects keep full retention; they have no other copy.
//
// File handles are kept in IndexedDB keyed PER PROJECT ID (not a single fixed
// slot) so multiple file-bound projects can each be resumed independently —
// switching projects re-grants permission for that project's own handle
// rather than clobbering a single shared one.
//
// Target: Windows / Chromium (Chrome, Edge). Where the API is absent,
// isSupported() returns false and the UI should hide the File buttons.
//
// Public API:
//   isSupported()         → boolean
//   onStatus(fn)          → subscribe to {status,lastSaved,fileName,supported}; returns unsubscribe
//   getStatus()           → current snapshot
//   saveAs()              → pick a new file, bind it, write now                  (user gesture)
//   openFile()            → pick an existing file, load + bind it                (user gesture)
//   saveNow()              → flush a pending write immediately
//   tryResume()            → silent re-open of the ACTIVE project's file IF perm already granted (call on mount)
//   resumePrompt()          → re-grant permission + load for the active project    (user gesture)
//   resumeProjectFile(id)   → re-grant permission + load for a DIFFERENT project   (user gesture)
//                             (used when switching to a project whose localStorage
//                             blob was evicted but a file handle still exists)
//   unbindFile()            → fully detach the active project's file (stops autosave,
//                             clears its stored handle, marks it unbound)
//
// status values: 'no-file' | 'saved' | 'saving' | 'unsaved' | 'error'

import { projectStore } from './projectStore.js';
import { showToast } from './toast.js';

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

// ── IndexedDB: persist FileSystemFileHandles across sessions, ONE PER PROJECT ─
// File handles are structured-cloneable, so they store directly in IndexedDB.
// Keyed by project id (the same id projectStore.js uses for its localStorage
// index/blob keys) so each file-bound project can be resumed independently.
const IDB_NAME  = 'conductor_fsaa';
const IDB_STORE = 'handles';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function idbPut(id, handle) {
  if (!id) return;
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function idbGet(id) {
  if (!id) return null;
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r  = tx.objectStore(IDB_STORE).get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}
async function idbDelete(id) {
  if (!id) return;
  try {
    const db = await idb();
    await new Promise((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
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
    const json = JSON.stringify(projectStore.stampForSave());
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

async function detachInMemory() {
  // Called when the user switches to a DIFFERENT project (legacy switcher /
  // Open list). The file handle still belongs to the project we're leaving —
  // it stays valid in IndexedDB and that project's index entry keeps
  // fileBound:true, so it can be resumed later. We only need to stop writing
  // the new project's data into the old project's file.
  clearTimeout(_timer);
  _handle = null;
  _pendingResumeHandle = null;
  setStatus('no-file', { lastSaved: null, fileName: null });
}

async function fullUnbind() {
  // Called only from the explicit unbindFile() action: the user is actively
  // disconnecting THIS project from its file. Unlike detachInMemory(), this
  // clears the stored handle and marks the project unbound, which puts it
  // back under full localStorage retention (its only safety net once there's
  // no file backing it).
  const id = projectStore.activeId();
  clearTimeout(_timer);
  _handle = null;
  _pendingResumeHandle = null;
  await idbDelete(id);
  projectStore.setFileBound(id, false, null);
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

  // try/finally: loadExternalState() no longer throws on a bad file (see
  // projectStore.js) — it returns a report — but this flag still needs to
  // reliably clear even if something else in here throws unexpectedly.
  // Previously a plain assignment either side of the call left
  // _suppressResetDetach stuck true forever on any exception mid-load,
  // silently disabling the reset-detach listener for the rest of the
  // session.
  let result;
  _suppressResetDetach = true;
  try {
    result = projectStore.loadExternalState(state);   // emits 'reset' on success; writes under projectStore.activeId()
  } finally {
    _suppressResetDetach = false;
  }

  if (!result.ok) {
    // Nothing was mutated (loadExternalState rejected before touching
    // state) — the currently-open project, if any, is untouched. Surface
    // exactly why so the user can fix or discard the bad file, instead of
    // silently getting a corrupted project.
    throw new Error('That file is not a valid Conductor project: ' + result.errors.join(' '));
  }
  if (result.warnings.length) {
    const shown = result.warnings.slice(0, 3).join(' ');
    const more = result.warnings.length > 3 ? ` (+${result.warnings.length - 3} more)` : '';
    showToast(`"${handle.name}" needed repair on open: ${shown}${more}`, { type: 'warning', duration: 9000 });
  }

  const id = projectStore.activeId();
  _handle = handle;
  await idbPut(id, handle);
  projectStore.setFileBound(id, true, handle.name);
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
  const id = projectStore.activeId();
  _handle = handle;
  _pendingResumeHandle = null;
  await idbPut(id, handle);
  projectStore.setFileBound(id, true, handle.name);
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

// Detach the current file. Autosave-to-file stops, the stored handle is
// cleared, and the project goes back under full localStorage retention.
export async function unbindFile() {
  await fullUnbind();
}

// On app mount: silently re-open the ACTIVE project's last file IF permission
// is still granted. Returns { state: 'granted'|'prompt'|'none', fileName? }.
//   'granted' → already loaded, nothing more to do.
//   'prompt'  → a file exists but needs a user click to re-grant; show a
//               "Resume <fileName>" button that calls resumePrompt().
//   'none'    → nothing to resume.
export async function tryResume() {
  if (!isSupported()) return { state: 'none' };
  const id = projectStore.activeId();
  let handle;
  try { handle = await idbGet(id); } catch { return { state: 'none' }; }
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
      await idbDelete(id);
      projectStore.setFileBound(id, false, null);
      return { state: 'none' };
    }
  }

  // 'prompt' / 'denied' — re-granting needs a user gesture, so defer to a button.
  _pendingResumeHandle = handle;
  setStatus('no-file', { fileName: handle.name });
  return { state: 'prompt', fileName: handle.name };
}

// Call from a click handler to re-grant permission and load the active
// project's deferred file (the "↻ Resume <fileName>" button).
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

// Re-grant permission and load a file for a project OTHER than the one
// currently active — used when switching projects via the Open list and
// projectStore.openProject() reports needsFileResume (no cached localStorage
// blob, but the project's index entry says it has a bound file).
//
// IMPORTANT: the caller (App.svelte) must have already pointed projectStore's
// active id at `id` before calling this — projectStore.openProject() does
// this as part of returning needsFileResume — because loadFromHandle() always
// binds to whatever project is currently active in the store.
//
// Must be called from within a user-gesture context (e.g. directly inside a
// click handler) since requestPermission() requires one. Returns
// { state: 'loaded'|'denied'|'none'|'error', fileName? }.
export async function resumeProjectFile(id) {
  if (!isSupported()) return { state: 'none' };
  let handle;
  try { handle = await idbGet(id); } catch { return { state: 'none' }; }
  if (!handle) return { state: 'none' };

  let perm;
  try { perm = await handle.queryPermission({ mode: 'readwrite' }); }
  catch { return { state: 'none' }; }

  if (perm !== 'granted') {
    try { perm = await handle.requestPermission({ mode: 'readwrite' }); }
    catch (e) { console.error('[fsaa] resumeProjectFile permission request failed:', e); return { state: 'denied' }; }
  }
  if (perm !== 'granted') return { state: 'denied' };

  try {
    await loadFromHandle(handle);
    return { state: 'loaded', fileName: handle.name };
  } catch (e) {
    console.error('[fsaa] resumeProjectFile load failed:', e);
    return { state: 'error' };
  }
}

// ── wire into the store, once, at import time ────────────────────────────────
projectStore.on((event, _state, extra) => {
  if (event === 'change') {
    scheduleWrite();
  } else if (event === 'reset') {
    // A reset we didn't trigger means the user switched/started a project via
    // the legacy localStorage switcher or the Open list. The bound file
    // belongs to the *previous* project, not this one — stop writing into it,
    // but leave its handle and fileBound flag intact so it can be resumed
    // later. (Full unbind only happens via the explicit unbindFile() action.)
    if (_suppressResetDetach) return;
    detachInMemory();
  } else if (event === 'project-deleted') {
    // extra is the deleted project's id — drop its stored handle, if any.
    idbDelete(extra);
  }
});
