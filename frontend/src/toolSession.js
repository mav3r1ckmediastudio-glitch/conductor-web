// toolSession.js
// Active-tool registry + continuous tool-session lifecycle (Save/Cancel on RMB) and the search-marker scratch layer. Owns the shared _activeTool / _activeSession state; other modules register via setActiveTool(). Extracted from mapTools.js.

import { projectStore } from './projectStore.js';
import { requestSessionConfirm } from './sessionConfirm.js';
import { emptyFC, pointFC } from './mapGeom.js';

// ── TOOL MANAGEMENT ───────────────────────────────────────────────────────────

let _activeTool = null;


export function setActiveTool(tool) {
  _activeTool = tool;
}
export function clearTool(map) {
  if (_activeTool?.cleanup) _activeTool.cleanup();
  _activeTool = null;
  // If a continuous session is active and this clearTool() call did NOT come
  // from that session's own rearm() (see below), something else is taking
  // over the map (switching tools, closing a project, Escape elsewhere) —
  // treat that as an implicit Save so a dangling session/RMB listener never
  // leaks, without forcing a rollback the user didn't ask for.
  if (_activeSession && !_activeSession.rearming) {
    endActiveSession(map, 'save', _activeSession);
  }
  if (map) {
    map.getCanvas().style.cursor = '';
    if (map.getSource('rubberband-src')) map.getSource('rubberband-src').setData(emptyFC());
    if (map.getSource('snap-src'))       map.getSource('snap-src').setData(emptyFC());
    if (map.getSource('ba-rubber-src'))  map.getSource('ba-rubber-src').setData(emptyFC());
    if (map.getSource('search-marker-src')) map.getSource('search-marker-src').setData(emptyFC());
  }
}

// ── CONTINUOUS TOOL SESSIONS ────────────────────────────────────────────────
// Lets a repeatable action (point placement, or the shared select-based
// edit/delete/move flow) stay live across multiple actions instead of
// auto-deactivating after one — see docs/conductor-web-context.md, agreed
// 2 Jul 2026. RMB (contextmenu) opens a Save/Cancel confirmation
// (sessionConfirm.js) rather than silently ending:
//   Save   — keep everything done since activation, tool goes inert.
//   Cancel — full rollback: projectStore restored to its exact pre-session
//            state via snapshotState()/restoreState(), then tool goes inert.
//
// Callers re-arm the underlying one-shot activate*Tool() after each single
// action via session.rearm(fn) rather than calling it directly — activate*
// functions all call clearTool() at their own top as standard practice, and
// rearm() sets a guard flag so that internal call doesn't trip the "external
// tool switch ends the session" fallback in clearTool() above.

let _activeSession = null;

function endActiveSession(map, result, targetSession) {
  const session = targetSession || _activeSession;
  if (!session || session.ending || session !== _activeSession) return;
  session.ending = true;
  _activeSession = null;
  if (map) map.off('contextmenu', session.onContextMenu);
  if (result === 'cancel') projectStore.restoreState(session.snapshot);
  if (session.onEnd) session.onEnd(result);
}

// onEnd(result): called once the session has fully ended (map tool cleared,
// state restored if cancelled) — App.svelte uses this to reset rpMode /
// pending form state / activeToolLabel.
export function startToolSession(map, { onEnd, message } = {}) {
  // Defensively end any stale previous session first (shouldn't normally
  // happen — each entry point starts at most one session at a time).
  endActiveSession(map, 'save');

  const session = {
    snapshot: projectStore.snapshotState(),
    onEnd,
    ending: false,
    rearming: false,
    onContextMenu(e) {
      e.preventDefault();
      requestSessionConfirm(message).then((result) => endActiveSession(map, result, session));
    },
  };
  _activeSession = session;
  map.on('contextmenu', session.onContextMenu);

  return {
    end: (result) => endActiveSession(map, result, session),
    rearm(activateFn) {
      if (session.ending) return;
      session.rearming = true;
      try { activateFn(); } finally { session.rearming = false; }
    },
  };
}

export function hasActiveSession() {
  return !!_activeSession;
}

// Called by App.svelte's onAssetSearch() when a search finds a location.
// Replaces any previous marker (each new search moves the pin rather than
// stacking markers). Cleared automatically by clearTool() above.
export function setSearchMarker(map, lng, lat) {
  if (!map || !map.getSource('search-marker-src')) return;
  map.getSource('search-marker-src').setData(pointFC(lng, lat));
}

export function clearSearchMarker(map) {
  if (!map || !map.getSource('search-marker-src')) return;
  map.getSource('search-marker-src').setData(emptyFC());
}
