// playwright.config.js — E2E smoke test config for Conductor Web.
//
// Runs against the Vite DEV server (not a production build) — vite build's
// heavier Rollup/terser pass is unrelated to what these tests exercise, and
// dev server startup is faster in CI. VITE_TEST_MODE=1 activates
// App.svelte's blank-map-style shim (see that file), so no real MapTiler
// key or external network access is needed for the map to initialise.
//
// See tests/e2e/README.md before writing a new spec — in particular the
// File System Access API gotcha (native save/open pickers hang an
// unstubbed test) that fixtures.js's gotoApp()/stubNoFileSystemAccess()
// exist to work around.

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },

  // Chromium only, deliberately, for this first slice: the File System
  // Access API paths (fsaa.js) this app relies on for its primary save
  // model are Chromium-only in production too (isSupported() checks for
  // showSaveFilePicker/showOpenFilePicker, absent in Firefox/WebKit) — see
  // docs/TODO.md's note that Edge (Chromium) is the working browser this
  // app targets today. Add firefox/webkit projects once there's a real
  // cross-browser support matrix to test against (see the Commercial
  // Readiness Audit's "must publish a browser/OS support matrix" gap) —
  // don't add them speculatively before that decision is made.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port ' + PORT,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      VITE_TEST_MODE: '1',
    },
  },
});
