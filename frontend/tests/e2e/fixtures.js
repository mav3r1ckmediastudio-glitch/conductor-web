// fixtures.js — shared Playwright helpers for Conductor Web's E2E suite.
//
// FILE SYSTEM ACCESS API GOTCHA (read this before writing a new spec):
// Playwright's bundled Chromium implements window.showSaveFilePicker /
// showOpenFilePicker for real — unlike a real automated test run, there is
// no user present to click through the native OS picker those open, so an
// unstubbed call hangs the test indefinitely (headed) or errors
// unpredictably (headless). App.svelte's onProjectCreated() calls
// onSaveToFile() automatically right after project creation whenever
// fsaa.isSupported() is true, which it is by default in Playwright's
// Chromium. stubNoFileSystemAccess() below removes both APIs before any
// page script runs, so isSupported() correctly reports false and the app
// takes its normal non-Chromium/non-FSAA code path (same one real Firefox
// users hit today) instead of opening a picker. Call it before page.goto()
// in every spec unless the spec is specifically testing FSAA itself, in
// which case stub the picker functions to return a fake handle instead of
// deleting them.
export async function stubNoFileSystemAccess(page) {
  await page.addInitScript(() => {
    delete window.showSaveFilePicker;
    delete window.showOpenFilePicker;
  });
}

// Standard boot: stub FSAA away, load the app in E2E test mode (blank map
// style — see App.svelte's E2E_TEST_MODE — so no MapTiler key or external
// network access is needed for the map to initialise), then click through
// the SplashLogin entry screen.
//
// THE SPLASH SCREEN IS NOT OPTIONAL: main.js mounts AppGate.svelte, which
// renders SplashLogin (branding + a "Continue to Conductor Web" button —
// deliberately not real auth, see main.js's comment) and only mounts
// App.svelte after that click. Discovered the first time this suite
// actually executed: every spec that skips this click sees only the splash
// and fails on its first assertion.
export async function gotoApp(page, baseURL) {
  await stubNoFileSystemAccess(page);
  await page.goto(baseURL || '/');
  await page.getByRole('button', { name: 'Continue to Conductor Web' }).click();
}
