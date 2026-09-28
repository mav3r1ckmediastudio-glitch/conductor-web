// wireless.spec.js — wireless planning operator journey.
//
// Seeds a small design (two sites, one PtP link, optionally a sector) via the
// guarded VITE_TEST_MODE seams, opens the REAL WirelessPanel, and drives it end
// to end: analyse -> verdict + profile -> edit an input -> result goes STALE and
// is hidden -> re-analyse. Terrain comes from the REAL browser tile fetcher
// (fetch + createImageBitmap + OffscreenCanvas) against intercepted MapTiler
// requests serving synthetic Terrain-RGB PNGs, so no network or key is needed.
// Coverage runs on the REAL Web Worker.
//
// Not covered here (needs a real map canvas, see README): placing sites/links by
// clicking the map and the radial wheel. Those tools are unit-tested at the
// store level (wirelessStore.test.js) and are the main thing still to
// verify by hand in a real browser.

import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { gotoApp } from './fixtures.js';

// ── minimal PNG encoder (RGBA, 8-bit) ───────────────────────────────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(rgba, w = 256, h = 256) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Terrain-RGB v2 encoding: height = -10000 + (R*65536 + G*256 + B) * 0.1
// Served at 512 px, like MapTiler's v2 tiles can be, so the downsampling path
// is exercised. heightAt() takes 256-px tile coordinates.
const TILE_PX = 512;
function tilePng(heightAt) {
  const n = TILE_PX, k = TILE_PX / 256;
  const rgba = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = Math.round((heightAt(x / k, y / k) + 10000) * 10), i = (y * n + x) * 4;
    rgba[i] = Math.floor(v / 65536); rgba[i + 1] = Math.floor((v % 65536) / 256); rgba[i + 2] = v % 256; rgba[i + 3] = 255;
  }
  return png(rgba, n, n);
}
const Z = 12;
const gxOfLng = (lng) => ((lng + 180) / 360) * 256 * 2 ** Z;

// ── seed ────────────────────────────────────────────────────────────────────
const A = { lng: -4.0, lat: 56.5 };
const B = { lng: -3.8395, lat: 56.5 };   // ~10 km east of A at this latitude
const site = (id, c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { site_id: id, mast_height_m: 30 } });
const SEED = (extra = {}) => ({
  stage: 'design', project: { areaId: 'TST' }, buildArea: null, cabinet: { properties: { pop_id: 'CAB-1' } },
  chambers: [], ducts: [], dropDucts: [], poles: [], spans: [], cbtTails: [], joints: [], cbts: [], aerialDrops: [], bundles: [], cables: [],
  addressPoints: [], fibreAssignments: [], physicalAssignments: [], physicalPlanStatus: 'UNVERIFIED', physicalPlanInputHash: null,
  wirelessSites: [site('S1', A), site('S2', B)],
  wirelessLinks: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[A.lng, A.lat], [B.lng, B.lat]] }, properties: {
    link_id: 'L1', site_a: 'S1', site_b: 'S2', freq_ghz: 5, tx_power_a_dbm: 25, gain_a_dbi: 30, rx_sensitivity_a_dbm: -80,
    tx_power_b_dbm: 25, gain_b_dbi: 30, rx_sensitivity_b_dbm: -80 } }],
  wirelessSectors: [], wirelessSettings: null, wirelessAnalysis: null,
  ...extra,
});

async function open(page, seed, terrain) {
  await gotoApp(page);
  await page.route('**/api.maptiler.com/tiles/terrain-rgb-v2/**', async (route) => {
    if (terrain === 'fail') return route.abort();
    const url = route.request().url();
    // Real MapTiler behaviour: the tile address comes from the TileJSON and is
    // WebP. A fetcher that guesses the URL (e.g. ".png") gets a 404, as it
    // would in production.
    if (url.includes('/tiles.json')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        tilejson: '2.0.0', minzoom: 0, maxzoom: 12, tileSize: TILE_PX,
        tiles: ['https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=e2e-key'] }) });
    }
    const m = url.match(/terrain-rgb-v2\/(\d+)\/(\d+)\/(\d+)\.webp/);
    if (!m) return route.fulfill({ status: 404, body: 'not found' });
    const tx = Number(m[2]);
    const h = terrain === 'ridge'
      ? (x) => (Math.abs(tx * 256 + x - gxOfLng((A.lng + B.lng) / 2)) <= 2 ? 400 : 100)
      : () => 100;
    await route.fulfill({ status: 200, contentType: 'image/png', body: tilePng(h) });
  });
  await page.evaluate(() => { window.__conductorMaptilerKey = 'e2e-key'; });
  await page.evaluate((s) => window.__conductorSeed(s), seed);
  await page.evaluate(() => window.__conductorOpenPanel('wireless-panel'));
}

test.describe('wireless planning journey', () => {
  test('unverified -> analyse -> VALIDATED -> edit -> STALE (verdicts hidden) -> re-analyse', async ({ page }) => {
    await open(page, SEED(), 'flat');

    await expect(page.getByTestId('wp-state')).toHaveText('UNVERIFIED');
    await expect(page.getByTestId('wp-link-row')).toHaveCount(1);
    await expect(page.getByTestId('wp-verdict')).toHaveCount(0);          // nothing is claimed before analysis

    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    await expect(page.getByTestId('wp-verdict')).toHaveText('PASS');

    await page.getByTestId('wp-link-row').locator('button.rowmain').click();
    await expect(page.getByTestId('wp-profile')).toBeVisible();
    await expect(page.getByTestId('wp-profile').locator('svg')).toBeVisible();

    // Edit a wireless input the way the edit form does — result must go stale immediately and stop being shown.
    await page.evaluate(() => window.__conductorStore.updateWirelessProps('link', 'L1', { tx_power_a_dbm: 20 }));
    await expect(page.getByTestId('wp-state')).toHaveText('STALE');
    await expect(page.getByTestId('wp-verdict')).toHaveCount(0);

    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
  });

  test('an implausible radio value fails the link; raising that limit in Engineering thresholds is honoured', async ({ page }) => {
    const seed = SEED();
    seed.wirelessLinks[0].properties.gain_a_dbi = 55;               // above the 50 dBi default ceiling
    await open(page, seed, 'flat');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('INVALID');
    await expect(page.locator('[data-testid="wp-issue"][data-code="LINK_PARAMS_IMPLAUSIBLE"]')).toContainText('allowed 0 to 50');

    await page.locator('button.fold', { hasText: 'Engineering thresholds' }).click();
    const field = page.getByTestId('ws-gainMaxDbi');
    await expect(field).toHaveValue('50');
    await field.fill('60');
    await field.press('Enter');
    await field.blur();
    await expect(page.getByTestId('wp-state')).toHaveText('STALE');        // limits are fingerprinted inputs

    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    await expect(page.locator('[data-code="LINK_PARAMS_IMPLAUSIBLE"]')).toHaveCount(0);
  });

  test('a ridge across the path fails the link and says why (LINK_OBSTRUCTED)', async ({ page }) => {
    await open(page, SEED(), 'ridge');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('INVALID');
    await expect(page.getByTestId('wp-verdict')).toHaveText('FAIL');
    await expect(page.getByTestId('wp-issue').first()).toHaveAttribute('data-code', 'LINK_OBSTRUCTED');
    await expect(page.getByTestId('wp-issue').first()).toContainText('L1');
  });

  test('terrain that cannot be loaded fails closed — never a silent pass', async ({ page }) => {
    await open(page, SEED(), 'fail');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('INVALID');
    await expect(page.getByTestId('wp-issue').first()).toHaveAttribute('data-code', 'LINK_NO_TERRAIN');
    await expect(page.getByTestId('wp-warning')).toContainText('failed to load');
  });

  test('a recorded survey (with a note) lets a link pass without terrain, and says so', async ({ page }) => {
    const seed = SEED();
    seed.wirelessLinks[0].properties.survey_los_confirmed = true;
    seed.wirelessLinks[0].properties.survey_note = 'Walked the path';
    await open(page, seed, 'fail');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    // The waived clearance problem stays visible as a note, alongside the explicit survey-override warning.
    await expect(page.locator('[data-testid=wp-note][data-code=LINK_SURVEYED_LOS]')).toBeVisible();
    await expect(page.locator('[data-testid=wp-note][data-code=LINK_NO_TERRAIN]')).toBeVisible();
    await expect(page.getByTestId('wp-issue')).toHaveCount(0);           // and nothing is left blocking
  });

  test('a link full of impossible values is repaired with "Fill with preset values" and then validates', async ({ page }) => {
    const seed = SEED();
    Object.assign(seed.wirelessLinks[0].properties, { freq_ghz: 200, tx_power_a_dbm: 200, tx_power_b_dbm: 200, gain_a_dbi: 200,
      gain_b_dbi: 200, rx_sensitivity_a_dbm: 200, rx_sensitivity_b_dbm: 200 });
    await open(page, seed, 'flat');
    await page.getByTestId('wp-analyse').click();
    await expect(page.locator('[data-testid="wp-issue"][data-code="LINK_PARAMS_IMPLAUSIBLE"]')).toBeVisible();

    await page.getByTestId('wp-edit-link').first().click();
    await expect(page.getByText('Gigabit backhaul (11 GHz licensed PtP)')).toBeVisible();
    await page.getByTestId('wf-apply-preset').click();
    await expect(page.getByTestId('wf-input-gain_a_dbi')).toHaveValue('38');
    await expect(page.getByTestId('wf-input-rx_sensitivity_b_dbm')).toHaveValue('-58');
    await page.getByTestId('wf-save').click();

    await expect(page.getByTestId('wp-state')).toHaveText('STALE');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    await expect(page.getByTestId('wp-verdict')).toHaveText('PASS');
  });

  test('editing a site through the form: required field blocks save; a valid save makes the plan stale', async ({ page }) => {
    await open(page, SEED(), 'flat');
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');

    await page.getByTestId('wp-edit-site').first().click();
    await page.getByTestId('wf-input-mast_height_m').fill('');
    await page.getByTestId('wf-save').click();
    await expect(page.getByTestId('wf-error-mast_height_m')).toHaveText('Required.');
    await expect(page.getByTestId('wf-save')).toBeVisible();              // still on the form: nothing was saved

    await page.getByTestId('wf-input-mast_height_m').fill('45');
    await page.getByTestId('wf-save').click();
    await expect(page.getByTestId('wp-state')).toHaveText('STALE');
    expect(await page.evaluate(() => window.__conductorStore.wirelessSites[0].properties.mast_height_m)).toBe(45);
  });

  test('coverage estimate runs on the worker, counts premises, and is hidden when inputs change', async ({ page }) => {
    const near = { lng: -3.985, lat: 56.5 };   // ~0.9 km east of S1, inside a 90-degree east-facing sector
    const seed = SEED({
      addressPoints: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [near.lng, near.lat] }, properties: { uprn: '1' } }],
      wirelessSectors: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [A.lng, A.lat] }, properties: {
        sector_id: 'X1', site_id: 'S1', azimuth_deg: 90, beamwidth_deg: 90, freq_ghz: 5, tx_power_dbm: 24, gain_dbi: 17,
        antenna_height_m: 30, range_m: 2500, cpe_height_m: 4, cpe_gain_dbi: 20, cpe_min_rx_dbm: -75 } }],
    });
    await open(page, seed, 'flat');
    await page.getByTestId('wp-coverage').click();
    await expect(page.getByTestId('wp-coverage-summary')).toContainText('1 of 1');

    await page.evaluate(() => window.__conductorStore.updateWirelessProps('sector', 'X1', { azimuth_deg: 270 }));
    await expect(page.getByTestId('wp-coverage-stale')).toBeVisible();
    await expect(page.getByTestId('wp-coverage-summary')).toHaveCount(0);   // never shown while stale
  });
});
