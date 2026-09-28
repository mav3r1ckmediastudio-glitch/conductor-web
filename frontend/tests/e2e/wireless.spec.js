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

  test('a link full of impossible values is repaired from the preset menu; the default airFiber-class preset is honest about a 10 km hop, the 11 GHz one passes', async ({ page }) => {
    const seed = SEED();
    Object.assign(seed.wirelessLinks[0].properties, { freq_ghz: 200, tx_power_a_dbm: 200, tx_power_b_dbm: 200, gain_a_dbi: 200,
      gain_b_dbi: 200, rx_sensitivity_a_dbm: 200, rx_sensitivity_b_dbm: 200 });
    await open(page, seed, 'flat');
    await page.getByTestId('wp-analyse').click();
    await expect(page.locator('[data-testid="wp-issue"][data-code="LINK_PARAMS_IMPLAUSIBLE"]')).toBeVisible();

    // Default preset = airFiber 60 LR class (mirrors the UISP reference design). Its note says where the numbers come from.
    await page.getByTestId('wp-edit-link').first().click();
    await expect(page.getByTestId('wf-preset-select')).toContainText('60 GHz PtP (airFiber 60 LR class)');
    await expect(page.getByTestId('wf-preset-note')).toContainText('FCC');
    await page.getByTestId('wf-apply-preset').click();
    await expect(page.getByTestId('wf-input-freq_ghz')).toHaveValue('69.12');
    await expect(page.getByTestId('wf-input-gain_a_dbi')).toHaveValue('38');
    await expect(page.getByTestId('wf-input-rx_sensitivity_b_dbm')).toHaveValue('-70');
    await page.getByTestId('wf-save').click();
    await expect(page.getByTestId('wp-state')).toHaveText('STALE');
    await page.getByTestId('wp-analyse').click();
    // ~10 km at 69.12 GHz leaves ~12 dB of spare signal: below the 15 dB reserve, so it fails and says why.
    await expect(page.getByTestId('wp-state')).toHaveText('INVALID');
    await expect(page.locator('[data-testid="wp-issue"][data-code="LINK_MARGIN_LOW"]')).toContainText('fade margin');

    // Switch the preset menu to the 11 GHz licensed link and fill: it passes.
    await page.getByTestId('wp-edit-link').first().click();
    await page.getByTestId('wf-preset-select').selectOption('ptp11');
    await expect(page.getByTestId('wf-preset-note')).toContainText('Ofcom link licence');
    await page.getByTestId('wf-apply-preset').click();
    await expect(page.getByTestId('wf-input-freq_ghz')).toHaveValue('11');
    await expect(page.getByTestId('wf-input-rx_sensitivity_b_dbm')).toHaveValue('-58');
    await page.getByTestId('wf-save').click();
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    await expect(page.getByTestId('wp-verdict')).toHaveText('PASS');
  });

  test('Add Sector through the tool wheel: the form arrives with azimuth aimed at the premises, and saves', async ({ page }) => {
    // 10 premises ~800 m north-west (bearing ~315) of S1, 3 to the south-east.
    const around = (brg, n) => Array.from({ length: n }, (_, i) => {
      const d = (800 + i) / 6371000, b = ((brg + (i % 5) - 2) * Math.PI) / 180, p1 = (A.lat * Math.PI) / 180, l1 = (A.lng * Math.PI) / 180;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [(l2 * 180) / Math.PI, (p2 * 180) / Math.PI] }, properties: { uprn: `U${brg}-${i}` } };
    });
    const seed = SEED({ addressPoints: [...around(315, 10), ...around(135, 3)] });
    await open(page, seed, 'flat');

    await page.locator('button.cat-pill', { hasText: 'Wireless' }).click();
    await page.getByRole('button', { name: 'Add Sector', exact: true }).click();
    await page.evaluate((c) => { const m = window.__conductorMap; m.jumpTo({ center: [c.lng, c.lat], zoom: 15 }); }, A);
    await page.waitForTimeout(500);
    const pt = await page.evaluate((c) => { const m = window.__conductorMap, p = m.project([c.lng, c.lat]), r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y }; }, A);
    await page.mouse.click(pt.x, pt.y);

    await expect(page.getByTestId('wf-note')).toContainText('Pointing at 10 premises');
    const az = Number(await page.getByTestId('wf-input-azimuth_deg').inputValue());
    expect(Math.abs(az - 315)).toBeLessThanOrEqual(10);
    await expect(page.getByTestId('wf-input-freq_ghz')).toHaveValue('5.8');   // default access preset (5.8 GHz LTU class) applied
    await page.getByTestId('wf-save').click();
    await expect.poll(() => page.evaluate(() => window.__conductorStore.wirelessSectors.length)).toBe(1);
    expect(await page.evaluate(() => window.__conductorStore.wirelessSectors[0].properties.azimuth_deg)).toBe(az);
  });

  test('drag the aiming handle on the map: the form follows, a saved sector can be re-aimed, and typing moves the handle', async ({ page }) => {
    test.setTimeout(120000);      // a long real-mouse journey: create, drag, type, save, analyse, re-aim
    const dest = (brg, m) => {
      const d = m / 6371000, b = (brg * Math.PI) / 180, p1 = (A.lat * Math.PI) / 180, l1 = (A.lng * Math.PI) / 180;
      const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
      const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
      return { lng: (l2 * 180) / Math.PI, lat: (p2 * 180) / Math.PI };
    };
    const cluster = (brg, n) => Array.from({ length: n }, (_, i) => ({ type: 'Feature', properties: { uprn: `U${brg}-${i}` },
      geometry: { type: 'Point', coordinates: Object.values(dest(brg + (i % 5) - 2, 800 + i)) } }));
    await open(page, SEED({ addressPoints: [...cluster(315, 10), ...cluster(45, 6)] }), 'flat');

    const screen = (c) => page.evaluate((c) => { const m = window.__conductorMap, p = m.project([c.lng, c.lat]), r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y }; }, c);
    const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 }); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up(); };
    const azBox = page.getByTestId('wf-input-azimuth_deg');
    const storeAz = () => page.evaluate(() => Number(window.__conductorStore.wirelessSectors[0]?.properties.azimuth_deg));

    // Create a sector: it opens aimed at the biggest cluster (~315).
    await page.locator('button.cat-pill', { hasText: 'Wireless' }).click();
    await page.getByRole('button', { name: 'Add Sector', exact: true }).click();
    // Put the site in the middle of the visible map area so every handle is reachable by the mouse.
    await page.evaluate((c) => window.__conductorMap.jumpTo({ center: [c.lng, c.lat], zoom: 13 }), A);
    await page.waitForTimeout(400);
    const at0 = await screen(A);
    await page.evaluate(([dx, dy]) => window.__conductorMap.panBy([dx, dy], { duration: 0 }), [at0.x - 560, at0.y - 380]);
    await page.waitForTimeout(400);
    await page.mouse.click((await screen(A)).x, (await screen(A)).y);
    await expect(page.getByTestId('wf-note')).toContainText('Pointing at 10 premises');
    expect(Math.abs(Number(await azBox.inputValue()) - 315)).toBeLessThanOrEqual(10);

    // Drag the amber (ghost) handle from its current tip round to the north-east cluster.
    await page.waitForTimeout(300);
    const tipNow = await screen(dest(Number(await azBox.inputValue()), 1200));
    await dragTo(tipNow, await screen(dest(45, 900)));
    expect(Math.abs(Number(await azBox.inputValue()) - 45)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('wf-note')).toContainText('Pointing at 6 premises');   // live count follows the drag

    // Typing an azimuth moves the handle (form -> map): type 180, then the handle is due south.
    await azBox.fill('180');
    await page.waitForTimeout(300);
    const south = await screen(dest(180, 1200)), a = await screen(A);
    expect(Math.abs(south.x - a.x)).toBeLessThan(3);
    expect(south.y).toBeGreaterThan(a.y);
    await page.mouse.move(south.x, south.y);                                             // the handle is really there to grab
    await dragTo(south, await screen(dest(45, 900)));
    expect(Math.abs(Number(await azBox.inputValue()) - 45)).toBeLessThanOrEqual(2);

    await page.getByTestId('wf-save').click();
    await expect.poll(storeAz).toBeGreaterThan(40);
    expect(Math.abs(await storeAz() - 45)).toBeLessThanOrEqual(2);

    // Re-aim the SAVED sector by dragging its blue handle; the project updates on release and results go stale.
    await page.getByTestId('wp-analyse').click();
    await expect(page.getByTestId('wp-state')).toHaveText('VALIDATED');
    await page.waitForTimeout(300);
    await dragTo(await screen(dest(45, 1200)), await screen(dest(200, 900)));
    await expect.poll(storeAz).toBeGreaterThan(190);
    expect(Math.abs(await storeAz() - 200)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('wp-state')).toHaveText('STALE');
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
