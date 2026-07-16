// branch-classification.spec.js — release-audit §3 / handoff §4 acceptance E2E.
//
// The paid-beta gate: a user resolves every PASS_THROUGH vs SPLITTER_OUTPUT
// decision entirely in the app, reaches a VALIDATED physical plan, sees splice
// export become available, then sees it close again the moment a planning input
// changes — with no JSON editing.
//
// The spec seeds a ready-made design (an onward branch left UNCLASSIFIED as it
// leaves a splitter) via the guarded VITE_TEST_MODE seams (window.__conductorSeed
// / __conductorOpenPanel / __conductorStore), then drives the REAL
// BranchClassificationPanel — its resolve buttons, re-run-planning button, and
// live export-readiness indicator. Seeding the data + opening the panel by mode
// avoids the map canvas and the SVG radial wheel, which are far too brittle
// headless; the panel and its wiring are the actual §4 surface under test.
// See tests/e2e/README.md + fixtures.js.

import { test, expect } from '@playwright/test';
import { gotoApp } from './fixtures.js';

// A splitter (JNT-001, 1:4) whose onward branch CBL-ON has NO feed_mode — it
// leaves a splitter, so the planner must not guess it (INFERRED_CLASSIFICATION).
const SEED = {
  stage: 'design', project: { area_id: 'TST' }, buildArea: null,
  cabinet: { properties: { pop_id: 'CAB-1' } },
  chambers: [], ducts: [], dropDucts: [], poles: [], spans: [], cbtTails: [], addressPoints: [],
  joints: [
    { properties: { joint_id: 'JNT-001', has_splitter: true, split_ratio: '1:4' } },
    { properties: { joint_id: 'JNT-002', has_splitter: true, split_ratio: '1:8' } },
  ],
  cbts: [], aerialDrops: [],
  bundles: [{ properties: { uprn: '1000001', bundle_id: 'BUN-1', from_joint: 'JNT-002' } }],
  cables: [
    { properties: { cable_id: 'CBL-IN', from_node: 'CAB-1', to_node: 'JNT-001', fibre_count: 96, feed_mode: 'PASS_THROUGH' } },
    { properties: { cable_id: 'CBL-ON', from_node: 'JNT-001', to_node: 'JNT-002', fibre_count: 48 } }, // unclassified
  ],
  fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
};

async function seedAndOpen(page) {
  await page.evaluate((s) => window.__conductorSeed(s), SEED);
  await page.evaluate(() => window.__conductorOpenPanel('branch-classify'));
}

test.describe('§4 branch-classification lifecycle', () => {
  test('resolve in-app → VALIDATED → export opens → edit closes it — no JSON', async ({ page }) => {
    await gotoApp(page);
    await seedAndOpen(page);

    // 1) The unclassified splitter branch is listed and export is blocked.
    await expect(page.getByTestId('bcp-row')).toHaveCount(1);
    await expect(page.getByTestId('bcp-count')).toContainText('1 unclassified');
    await expect(page.getByTestId('bcp-export-blocked')).toBeVisible();

    // 2) Resolve it as a raw pass-through with one click — list clears.
    await page.getByTestId('bcp-resolve-pass').click();
    await expect(page.getByTestId('bcp-all-clear')).toBeVisible();
    await expect(page.getByTestId('bcp-ready-to-plan')).toBeVisible();

    // 3) Re-run planning → plan validates → splice export becomes available.
    await page.getByTestId('bcp-replan').click();
    await expect(page.getByTestId('bcp-export-ready')).toBeVisible();

    // 4) Edit a planning input (feeder capacity) WITHOUT re-planning — the exact
    //    write AssetEditPanel makes — and the export gate closes immediately
    //    (stale fingerprint). Fail-closed, no JSON editing.
    await page.evaluate(() => {
      const ps = window.__conductorStore;
      const idx = ps.state.cables.findIndex((c) => c.properties.cable_id === 'CBL-IN');
      ps.updateAsset('cables', idx, { fibre_count: 72 });
    });
    // Plan status is still VALIDATED, but the fingerprint is now stale, so the
    // panel shows the gated-until-replan state and export is no longer available.
    await expect(page.getByTestId('bcp-export-stale')).toBeVisible();
    await expect(page.getByTestId('bcp-export-ready')).toHaveCount(0);
  });

  test('classifying as splitter output is also accepted and clears the branch', async ({ page }) => {
    await gotoApp(page);
    await seedAndOpen(page);
    await expect(page.getByTestId('bcp-row')).toHaveCount(1);
    await page.getByTestId('bcp-resolve-split').click();
    await expect(page.getByTestId('bcp-all-clear')).toBeVisible();
  });
});
