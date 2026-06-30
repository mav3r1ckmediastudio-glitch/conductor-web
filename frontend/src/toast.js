// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────
// Lightweight, non-blocking replacement for native alert(). Works from both
// Svelte components AND plain JS modules (mapTools.js) via a simple pub/sub,
// mirroring the existing projectStore.on() pattern already used in this codebase.
//
// Usage:
//   import { showToast, showError } from './toast.js';
//   showToast('A build area needs at least 3 points.');   // info, auto-dismiss ~4s
//   showError('Could not save file: ' + e.message);       // error, auto-dismiss ~8s, red
//
// BUFFERING: a few call sites (projectStore.js's initial load/migration,
// main.js's Clerk OAuth callback) can fire before the Toast component has
// mounted — there's no UI on screen yet to show anything. Rather than lose
// those silently, emit() buffers them in _pending and onToast() flushes the
// buffer to the first real listener that subscribes, so an error at app boot
// still surfaces the moment the UI is actually on screen.

let _listeners = [];
let _pending = [];
let _id = 0;

export function onToast(fn) {
  _listeners.push(fn);
  if (_pending.length) {
    const queued = _pending;
    _pending = [];
    queued.forEach(fn);
  }
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

function emit(toast) {
  if (_listeners.length === 0) {
    _pending.push(toast);
    return;
  }
  _listeners.forEach(fn => fn(toast));
}

// Info/validation-level notice — short-lived, cyan accent.
export function showToast(message, opts = {}) {
  const toast = {
    id: ++_id,
    message,
    type: opts.type || 'info',
    duration: opts.duration ?? 4500,
  };
  emit(toast);
  return toast.id;
}

// Failure notice (save/load/export errors) — longer-lived, red accent.
// Doesn't auto-vanish as quickly since these matter more than a validation nudge.
export function showError(message) {
  return showToast(message, { type: 'error', duration: 8000 });
}
