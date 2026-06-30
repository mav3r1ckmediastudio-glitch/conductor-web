# FSAA Integration Guide — Conductor Web

This adds a durable `.conductor` file on disk with **in-place debounced autosave**
and **resume-on-relaunch**, layered on top of your existing localStorage system
(which keeps running underneath as a crash cache).

## Files

| File | Action |
|------|--------|
| `fsaa.js` | **New** — drop into `frontend/src/`. |
| `projectStore.js` | **Replace** your existing one. Only change: a new `loadExternalState()` method added directly above `newProject()`. Everything else is byte-identical. |
| `App.svelte` | **6 small edits** below. Anchor-based so they survive minor local drift. |

Nothing else changes. The fibre engines, map tools, and localStorage multi-project
switcher are untouched.

## How it behaves

- **Save File**: native Windows save dialog → you pick `Tarvin.conductor`. From then
  on every store change auto-writes to that file (debounced ~1.2s).
- **Open File**: native open dialog → loads a `.conductor` file, binds it for autosave.
- **Resume on relaunch**: the file handle is persisted in IndexedDB. On next launch,
  if Chrome still holds permission it loads silently; if it needs a re-grant you get a
  one-click **Resume <filename>** button (browsers require a user gesture to re-grant).
- **Switching projects via the legacy "Open ▾" / "+ New"** automatically unbinds the
  file, so File A can never be overwritten with Project B's data.
- **Ctrl+S** flushes a pending write immediately (optional, edit #6).

> Windows/Chromium only — exactly your target. On any browser without the API,
> `fsaa.supported` is false and the File buttons simply don't render.

---

## App.svelte edits

### Edit 1 — import (after the `projectStore` import, ~line 23)

Find:
```js
  import { projectStore } from './projectStore.js';
```
Insert immediately after:
```js
  import {
    isSupported  as fsaaSupported,
    onStatus     as fsaaOnStatus,
    saveAs       as fsaaSaveAs,
    openFile     as fsaaOpenFile,
    saveNow      as fsaaSaveNow,
    tryResume    as fsaaTryResume,
    resumePrompt as fsaaResumePrompt,
  } from './fsaa.js';
```

### Edit 2 — state + handlers (find `let showOpen = false;`, ~line 1167)

Find:
```js
  let showOpen = false;
  let projectList = [];
```
Insert immediately after:
```js
  // ── File System Access (durable .conductor file) ──────────────────────────
  let fsaa = { status: 'no-file', lastSaved: null, fileName: null, supported: false };
  let fsaaResume = null;   // { fileName } when a saved file is waiting for a resume click
  fsaaOnStatus(s => { fsaa = s; });

  function fmtSaved(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  async function onSaveToFile() {
    try { await fsaaSaveAs(); }
    catch (e) { alert('Could not save file: ' + (e?.message || e)); }
  }
  async function onOpenFile() {
    try {
      if (await fsaaOpenFile()) {
        rpMode = 'default'; activeToolLabel = '';
        if (map) syncToMap(map);
      }
    } catch (e) { alert('Could not open file: ' + (e?.message || e)); }
  }
  async function onResumeFile() {
    if (await fsaaResumePrompt()) {
      fsaaResume = null;
      rpMode = 'default'; activeToolLabel = '';
      if (map) syncToMap(map);
    }
  }
```

### Edit 3 — resume on relaunch (inside `onMount`, the `map.on('load')` block, ~line 332)

Find:
```js
    map.on('load', () => {
      setupMapLayers(map);
      if (projectStore.stage === 'import') rpMode = 'address-import';
    });
```
Replace with:
```js
    map.on('load', () => {
      setupMapLayers(map);
      if (projectStore.stage === 'import') rpMode = 'address-import';
      // FSAA: silently resume the last .conductor file if still permitted,
      // else surface a one-click Resume button (re-grant needs a user gesture).
      fsaaTryResume().then(r => {
        if (r.state === 'granted') {
          rpMode = projectStore.stage === 'import' ? 'address-import' : 'default';
          syncToMap(map);
        } else if (r.state === 'prompt') {
          fsaaResume = { fileName: r.fileName };
        }
      });
    });
```

### Edit 4 — toolbar buttons + indicator (find the `+ New` button, ~line 1252)

Find:
```svelte
      <button class="tb-new" on:click={newProject} title="New Project">+ New</button>
```
Insert immediately **before** it:
```svelte
      {#if fsaa.supported}
        {#if fsaaResume}
          <button class="tb-resume" on:click={onResumeFile} title="Reconnect to your last project file">↻ Resume {fsaaResume.fileName}</button>
        {/if}
        <div class="fsaa-grp">
          <button class="tb-new" on:click={onSaveToFile} title="Save project to a file on disk">⤓ Save File</button>
          <button class="tb-new" on:click={onOpenFile}  title="Open a .conductor file from disk">⤢ Open File</button>
          <span class="fsaa-ind"
                class:saved={fsaa.status === 'saved'}
                class:saving={fsaa.status === 'saving'}
                class:unsaved={fsaa.status === 'unsaved'}
                class:error={fsaa.status === 'error'}
                title={fsaa.fileName || ''}>
            {#if fsaa.status === 'saving'}Saving…
            {:else if fsaa.status === 'saved'}Saved {fmtSaved(fsaa.lastSaved)}
            {:else if fsaa.status === 'unsaved'}Unsaved…
            {:else if fsaa.status === 'error'}⚠ Not saved
            {:else}No file{/if}
          </span>
        </div>
      {/if}
```

### Edit 5 — Ctrl+S (optional but recommended)

Find:
```svelte
<svelte:window on:click={() => { showOpen = false; userMenuOpen = false; }} />
```
Replace with:
```svelte
<svelte:window on:click={() => { showOpen = false; userMenuOpen = false; }} on:keydown={onKeydown} />
```
Then add this handler anywhere in the `<script>` (e.g. just below `onResumeFile`):
```js
  function onKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      if (fsaa.supported && fsaa.fileName) { e.preventDefault(); fsaaSaveNow(); }
    }
  }
```

### Edit 6 — CSS (add near the `.tb-new` / `.tb-open-*` rules, ~line 1673)

```css
  /* ── FSAA file controls ── */
  .fsaa-grp { display: flex; align-items: center; gap: 6px; padding-left: 6px; margin-left: 2px; border-left: 1px solid #1a2d40; }
  .fsaa-ind { font-family: 'Courier New', monospace; font-size: 8.5px; letter-spacing: 0.04em; color: #3a5a70; white-space: nowrap; min-width: 68px; }
  .fsaa-ind.saved   { color: #5dd6a0; }
  .fsaa-ind.saving  { color: #ffc04d; }
  .fsaa-ind.unsaved { color: #ffc04d; }
  .fsaa-ind.error   { color: #ff6b6b; }
  .tb-resume { background: #102030; border: 1px solid #00aaff55; color: #4dc8ff; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; animation: fsaaPulse 2s ease-in-out infinite; }
  .tb-resume:hover { background: #15273a; border-color: #4dc8ff; }
  @keyframes fsaaPulse { 0%,100% { box-shadow: 0 0 0 0 #00aaff00; } 50% { box-shadow: 0 0 8px 0 #00aaff44; } }
```

---

## Test checklist

1. **Build clean**: `npm run build` — no new errors. (`fsaa.js` has no new deps.)
2. **Save File**: design something → click **Save File** → pick a location. A
   `.conductor` file appears on disk; indicator flips to **Saved hh:mm**.
3. **Autosave**: add a chamber → indicator briefly shows **Unsaved…** then **Saved**.
   Re-open the file in a text editor and confirm the new chamber is in the JSON.
4. **Relaunch (granted)**: refresh the tab → project loads automatically, map renders,
   indicator shows the filename. (Chrome usually keeps permission within a session.)
5. **Relaunch (re-grant)**: fully close + reopen the browser → you should see the
   **↻ Resume <file>** button → click it → Chrome's permission chip → project loads.
6. **Project isolation**: bind File A, then use the legacy **Open ▾** to switch to a
   different localStorage project → indicator returns to **No file** (File A is now
   unbound and safe). Edits to the new project do NOT touch File A.
7. **Ctrl+S**: forces an immediate write (watch the indicator).
8. **Unsupported browser** (e.g. Firefox, just to confirm graceful degrade): File
   buttons don't render; the app works exactly as before on localStorage.

## Optional addendum — one-time "save this project" nudge

By design, FSAA doesn't force a save location at project creation (most desktop
apps don't either — see discussion). But leaving someone working for twenty
minutes on localStorage-only with zero nudge isn't great either. This adds a
single dismissible prompt, fired once per session, the first time the project
reaches the `'design'` stage (i.e. once there's something worth losing) while
no file is bound yet.

No changes to `fsaa.js` or `projectStore.js` — this is App.svelte only.

### Edit 7 — nudge state + reactive trigger (add near Edit 2's FSAA block)

Find the FSAA state block you added in Edit 2:
```js
  let fsaa = { status: 'no-file', lastSaved: null, fileName: null, supported: false };
  let fsaaResume = null;
  fsaaOnStatus(s => { fsaa = s; });
```
Add immediately after:
```js
  // One-time nudge: prompt to save-to-file once real work exists (stage → 'design')
  // and no file is bound yet. Fires once per session; dismissing just hides it,
  // it does not suppress future sessions (kept deliberately simple — no extra
  // persistence layer for a one-line prompt).
  let hasNudged = false;
  let showSaveNudge = false;
  $: if (stage === 'design' && fsaa.supported && !fsaa.fileName && !hasNudged) {
    hasNudged = true;
    showSaveNudge = true;
  }
  function dismissNudge() { showSaveNudge = false; }
  async function onNudgeSave() {
    showSaveNudge = false;
    await onSaveToFile();
  }
```

### Edit 8 — the banner itself

Place this just inside `<div class="screen">`, before the `{#if stage === 'setup'}` block, so it floats above everything:

```svelte
  {#if showSaveNudge}
    <div class="save-nudge" role="alert">
      <span>Save this project to a file? Keeps your work safe on disk with autosave.</span>
      <button class="sn-save" on:click={onNudgeSave}>Save File</button>
      <button class="sn-dismiss" on:click={dismissNudge} title="Dismiss">✕</button>
    </div>
  {/if}
```

### Edit 9 — CSS (add alongside the Edit 6 FSAA styles)

```css
  .save-nudge {
    position: fixed; top: 56px; right: 16px; z-index: 200;
    display: flex; align-items: center; gap: 10px;
    background: #0d1520; border: 1px solid #00aaff55; border-radius: 6px;
    padding: 10px 12px; box-shadow: 0 8px 24px #00000088;
    font-family: 'Courier New', monospace; font-size: 10.5px; color: #a0c4d8;
    max-width: 320px; animation: fsaaPulse 2.5s ease-in-out infinite;
  }
  .sn-save { background: #102030; border: 1px solid #4dc8ff; color: #4dc8ff; font-size: 9px; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
  .sn-save:hover { background: #15273a; }
  .sn-dismiss { background: transparent; border: none; color: #5b7488; cursor: pointer; font-size: 11px; padding: 2px 4px; }
  .sn-dismiss:hover { color: #a0c4d8; }
```

(`@keyframes fsaaPulse` is already defined in Edit 6 — reused here, no duplicate needed.)

### Test

1. Create a new project, go through setup/import/build-area/cabinet to reach `design` stage without ever clicking Save File → banner appears once.
2. Click **Save File** in the banner → picker opens, behaves identically to the toolbar button, banner disappears.
3. Click **✕** instead → banner disappears, doesn't reappear this session even as you keep editing.
4. If you'd already clicked the toolbar **Save File** button before reaching `design` stage, the banner never fires at all (the `!fsaa.fileName` guard).


- **One file = the whole project blob** (same JSON your localStorage already stores),
  not a folder of per-layer files.
- **localStorage stays on** as a crash cache; the file is the durable, user-owned copy.
  This is what neutralises the audit's silent-quota-loss risk — file writes have no quota.
- The **silent localStorage catch** in `save()` is still silent. That was a separate
  Phase-1 audit item; with FSAA bound it's no longer the system of record, but if you
  want the "changes not saved" banner for the no-file case too, that's a small follow-up.
- `.conductor` is just JSON — `.json` files also open fine (the open dialog accepts both).
