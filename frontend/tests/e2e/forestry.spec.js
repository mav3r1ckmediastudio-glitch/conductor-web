// forestry.spec.js — forestry import, cookie-cutter clipping, 3D rendering
// (forest stands with typical/assumed height, and real-height wireless towers).

import { test, expect } from '@playwright/test';
import { gotoApp } from './fixtures.js';

const A = { lng: -4.0, lat: 56.5 };
// A ~1 km square build area centred on A.
const BUILD_AREA = { type: 'Feature', properties: { name: 'Test area' }, geometry: { type: 'Polygon',
  coordinates: [[[A.lng - 0.01, A.lat - 0.006], [A.lng + 0.01, A.lat - 0.006], [A.lng + 0.01, A.lat + 0.006], [A.lng - 0.01, A.lat + 0.006], [A.lng - 0.01, A.lat - 0.006]]] } };
const site = (id, c, mast_height_m) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m } });

const BASE_SEED = (extra = {}) => ({
  stage: 'design', project: { areaId: 'TST' }, buildArea: null, cabinet: { properties: { pop_id: 'CAB-1' } },
  chambers: [], ducts: [], dropDucts: [], poles: [], spans: [], cbtTails: [], joints: [], cbts: [], aerialDrops: [], bundles: [], cables: [],
  addressPoints: [], fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
  wirelessSites: [], wirelessLinks: [], wirelessSectors: [], wirelessSettings: null, wirelessAnalysis: null,
  forestryStands: [],
  ...extra,
});

async function open(page, seed) {
  await gotoApp(page);
  // Wait for the map to actually be ready before seeding: __conductorSeed's
  // resync (via projectStore's generic change subscription) is guarded by
  // `if (map)` with no retry, so seeding into a not-yet-initialised map would
  // silently never sync — the same readiness signal smoke.spec.js uses.
  await page.waitForFunction(() => window.map && !!window.map.getSource('chambers-src'), { timeout: 10000 });
  await page.evaluate((s) => window.__conductorSeed(s), seed);
}

const standGeoJSON = (features) => JSON.stringify({ type: 'FeatureCollection', features });
const stand = (coords, IFT_IOA, CATEGORY = 'Woodland') => ({
  type: 'Feature', properties: { IFT_IOA, CATEGORY },
  geometry: { type: 'Polygon', coordinates: [coords] },
});
// A tiny square stand centred at (lng,lat).
const squareAt = (lng, lat, half = 0.001) => [[lng - half, lat - half], [lng + half, lat - half], [lng + half, lat + half], [lng - half, lat + half], [lng - half, lat - half]];

test.describe('forestry layer', () => {
  test('importing through the real UI classifies stands and auto-clips to an existing build area', async ({ page }) => {
    await open(page, BASE_SEED({ buildArea: BUILD_AREA }));

    await page.locator('button.asset-btn', { hasText: 'Import Forestry' }).click();
    await expect(page.getByText('Import Forestry Data')).toBeVisible();

    const inside = stand(squareAt(A.lng, A.lat), 'Conifer');
    const outside = stand(squareAt(A.lng + 0.05, A.lat), 'Broadleaved');   // well outside BUILD_AREA
    const cleared = stand(squareAt(A.lng + 0.001, A.lat + 0.001), 'Felled');   // inside, but no canopy

    await page.getByTestId('forestry-file-input').setInputFiles({
      name: 'stands.geojson', mimeType: 'application/geo+json',
      buffer: Buffer.from(standGeoJSON([inside, outside, cleared])),
    });

    await expect(page.getByText('3 stands loaded')).toBeVisible();
    await expect(page.getByText(/Conifer: 1/)).toBeVisible();
    await expect(page.getByText(/Cleared: 1/)).toBeVisible();

    await page.getByTestId('forestry-load').click();

    // Auto-clipped: the far-outside Broadleaved stand is gone, the two inside remain.
    const stored = await page.evaluate(() => window.__conductorStore.forestryStands.map(f => f.properties));
    expect(stored).toHaveLength(2);
    const conifer = stored.find(p => p.canopy_group === 'Conifer');
    expect(conifer).toMatchObject({ IFT_IOA: 'Conifer', typical_height_m: 20, height_source: 'typical' });
    const cleared2 = stored.find(p => p.canopy_group === 'Cleared');
    expect(cleared2.typical_height_m).toBe(0);
    expect(stored.some(p => p.IFT_IOA === 'Broadleaved')).toBe(false);
  });

  test('the forestry 3D layer only draws stands with real canopy height, toggles off/on, and re-cut works after the fact', async ({ page }) => {
    await open(page, BASE_SEED());   // no build area yet

    // Import first, with no build area present -> nothing is clipped away.
    await page.locator('button.asset-btn', { hasText: 'Import Forestry' }).click();
    const a = stand(squareAt(A.lng, A.lat), 'Conifer');
    const b = stand(squareAt(A.lng + 0.05, A.lat), 'Broadleaved');
    await page.getByTestId('forestry-file-input').setInputFiles({ name: 's.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(standGeoJSON([a, b])) });
    await page.getByTestId('forestry-load').click();
    expect(await page.evaluate(() => window.__conductorStore.forestryStands.length)).toBe(2);

    // Only the canopy-bearing (height>0) filter should be present on both forestry layers.
    const filterOk = await page.evaluate(() => {
      const m = window.__conductorMap;
      return ['forestry-3d', 'forestry-outline'].every(id => JSON.stringify(m.getFilter(id)).includes('typical_height_m'));
    });
    expect(filterOk).toBe(true);

    // Toggle off, then on: the layer's own visibility layout property follows.
    const vis = () => page.evaluate(() => window.__conductorMap.getLayoutProperty('forestry-3d', 'visibility'));
    await expect.poll(vis).toBe('visible');
    await page.locator('button.asset-btn', { hasText: /^♣ Forestry$/ }).click();
    await expect.poll(vis).toBe('none');
    await page.locator('button.asset-btn', { hasText: /^♣ Forestry$/ }).click();
    await expect.poll(vis).toBe('visible');

    // Now draw/save a build area retroactively via the store + the recut button (drawing the polygon
    // interactively is covered by the fibre-side build-area E2E; here we exercise the recut path directly).
    // setBuildArea() intentionally advances the onboarding stage to 'cabinet' as part of the
    // real import -> build-area -> cabinet -> design flow. This project is already past that
    // (stage: 'design', cabinet already placed in the seed), so set buildArea via _updateNow
    // directly, keeping stage put -- _updateNow (unlike a bare _state write) is what actually
    // emits the 'change' event App.svelte's reactivity depends on.
    await page.evaluate((ba) => window.__conductorStore._updateNow({ buildArea: ba, stage: 'design' }), BUILD_AREA);
    await page.locator('button.asset-btn', { hasText: 'Recut Forestry to Build Area' }).click();
    await expect.poll(() => page.evaluate(() => window.__conductorStore.forestryStands.length)).toBe(1);
    expect(await page.evaluate(() => window.__conductorStore.forestryStands[0].properties.IFT_IOA)).toBe('Conifer');
  });

  test('a wireless site with a real mast height gets a solid 3D tower; forestry stays visually distinct (dashed/translucent)', async ({ page }) => {
    await open(page, BASE_SEED({ wirelessSites: [site('S1', A, 25)] }));

    // NB: this MapLibre build wraps a GeoJSON source's live data one level
    // deeper than the public API's own shape -- _data.geojson.features, not
    // _data.features. Confirmed by direct inspection; not documented anywhere
    // obvious, so worth this comment for the next person who queries a source
    // this way.
    const towerFeatures = () => page.evaluate(() => window.__conductorMap?.getSource('wireless-towers-src')?._data?.geojson?.features);
    await expect.poll(() => towerFeatures().then(f => f?.length)).toBe(1);
    const tower = (await towerFeatures())[0];
    expect(tower.properties.mast_height_m).toBe(25);
    expect(tower.geometry.type).toBe('Polygon');

    const paints = await page.evaluate(() => {
      const m = window.__conductorMap;
      return {
        towerOpacity: m.getPaintProperty('wireless-towers-3d', 'fill-extrusion-opacity'),
        forestryOpacity: m.getPaintProperty('forestry-3d', 'fill-extrusion-opacity'),
        forestryDash: m.getPaintProperty('forestry-outline', 'line-dasharray'),
      };
    });
    // Real, stored data (tower) renders more solidly than an assumed value (forestry).
    expect(paints.towerOpacity).toBeGreaterThan(paints.forestryOpacity);
    expect(paints.forestryDash).toEqual([2, 2]);
  });
});
