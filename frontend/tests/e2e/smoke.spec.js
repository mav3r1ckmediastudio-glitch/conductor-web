// smoke.spec.js — first-slice E2E smoke tests for Conductor Web.
//
// WHY THIS EXISTS: the app has zero automated coverage of its actual UI/map
// behaviour today — the 199 vitest tests are all pure-logic modules
// (designHealth, fibreAssign, projectSchema, etc.), none of them touch
// App.svelte or mapTools.js. That's flagged in the 15 Jul 2026 Commercial
// Readiness Audit ("Add Playwright smoke journeys for project
// create/open/save, drawing, editing, delete, export and map refresh") and
// is also the actual prerequisite for safely refactoring App.svelte/
// mapTools.js later — you can't confidently split up untested code.
//
// SCOPE OF THIS FIRST SLICE: deliberately small and high-confidence rather
// than a full journey. It proves the harness itself works end-to-end
// (dev server boots, FSAA picker gotcha is handled, the E2E_TEST_MODE
// blank-map-style shim actually avoids needing a real MapTiler key) and
// covers the one workflow transition every other journey depends on
// (setup -> import). Extend outward from here one journey at a time,
// running `npx playwright test --ui` locally to iterate against real
// failures rather than guessing — see tests/e2e/README.md.
//
// SELECTOR NOTE: ProjectSetup.svelte's <label> elements are NOT associated
// with their inputs (no `for`/`id`, no wrapping) — getByLabel() will not
// find them. Using getByPlaceholder()/role-based queries instead, which is
// what actually works against this markup as it exists today.

import { test, expect } from '@playwright/test';
import { gotoApp } from './fixtures.js';

test.describe('App boot', () => {
  test('loads and shows the New Project setup modal', async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByText('FTTP DESIGN INTELLIGENCE')).toBeVisible();
    await expect(page.getByText('NEW PROJECT')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create Project/ })).toBeVisible();
  });

  test('map initialises without a real MapTiler key (E2E_TEST_MODE blank style)', async ({ page }) => {
    await gotoApp(page);
    // onMount() creates the map unconditionally, independent of workflow
    // stage — the ProjectSetup modal is an overlay on top of it, not a
    // replacement for it. window.map is exposed globally by App.svelte
    // (a diagnostic hook, not something we added for this test).
    //
    // Readiness signal: one of OUR OWN sources existing. That proves the
    // 'load' event fired AND setupMapLayers() built the app's layer stack —
    // a strictly stronger health check than map.loaded(), which this app
    // never settles to `true` on (its continuous GeoJSON sync keeps source
    // updates pending — found on this suite's first real execution).
    await page.waitForFunction(
      () => window.map && !!window.map.getSource('chambers-src'),
      { timeout: 10000 },
    );
    const canvasCount = await page.locator('#map canvas').count();
    expect(canvasCount).toBeGreaterThan(0);
  });
});

test.describe('Project setup', () => {
  test('creating a project advances the workflow stage from setup to import', async ({ page }) => {
    await gotoApp(page);

    await page.getByPlaceholder('e.g. Tyndrum Rural FTTP').fill('E2E Test Project');
    await page.getByPlaceholder('e.g. TTY').fill('E2E');
    await page.getByRole('button', { name: /Create Project/ }).click();

    // The setup modal is replaced by AddressImporter (App.svelte sets
    // rpMode = 'address-import' synchronously in onProjectCreated, gating
    // <AddressImporter> at rpMode === 'address-import') — this is the
    // actual stage-transition signal, not a guess at internal state shape.
    await expect(page.getByText('NEW PROJECT')).not.toBeVisible();
    await expect(page.getByLabel('Drop zone')).toBeVisible();
    await expect(page.getByText('Drop CSV or SHP here')).toBeVisible();
  });

  test('rejects an incomplete form (build code required) without advancing', async ({ page }) => {
    await gotoApp(page);

    await page.getByPlaceholder('e.g. Tyndrum Rural FTTP').fill('Missing Build Code');
    // Deliberately not filling the build-code field.
    await page.getByRole('button', { name: /Create Project/ }).click();

    await expect(page.getByText('Build code must be 2')).toBeVisible();
    // Still on the setup modal — no silent stage advance on invalid input.
    await expect(page.getByText('NEW PROJECT')).toBeVisible();
  });
});
