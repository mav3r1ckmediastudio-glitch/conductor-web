// ── TOAST NOTIFICATIONS ───────────────────────────────────────────────────────
// Lightweight, non-blocking replacement for native alert(). Works from both
// Svelte components AND plain JS modules (mapTools.js) via a simple pub/sub,
// mirroring the existing projectStore.on() pattern already used in this codebase.
//
// Usage:
//   import { showToast, showError } from './toast.js';
//   showToast('A build area needs at least 3 points.');   // info, auto-dismiss ~4s
//   showError('Could not save file: ' + e.message);       // error, auto-dismiss ~8s, red

let _listeners = [];
let _id = 0;

export function onToast(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(l => l !== fn); };
}

function emit(toast) {
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
