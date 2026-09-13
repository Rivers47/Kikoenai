import { test, expect } from '@playwright/test';

// Playback position is written to IndexedDB on this device, so a reload restores
// it without the server having been told. These drive a real browser because
// that is the only way to exercise IndexedDB and the 60s server throttle.
//
// Needs a dev server on :8080 with a scanned library -- see playwright.config.js.
// WORK_ID must be a work with at least one audio track.
const BASE = 'http://localhost:8080';
const WORK_ID = process.env.KIKO_TEST_WORK_ID || '000001';

const positionRows = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('kikoenai');
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('positions')) return resolve([]);
    const all = db.transaction('positions', 'readonly').objectStore('positions').getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => reject(all.error);
  };
}));

test.describe('local-first playback position', () => {
  test('a played track is recorded locally and survives a reload', async ({ page }) => {
    await page.goto(`${BASE}/work/${WORK_ID}`);
    await page.waitForSelector('.q-item', { timeout: 15000 });

    // Start the first audio track, then let the 10s local tick fire.
    await page.locator('.q-item').filter({ hasText: /\.(mp3|opus|flac|wav|m4a|webm)$/i }).first().click();
    await page.waitForTimeout(13000);

    const rows = await positionRows(page);
    expect(rows.length, 'a position row was written').toBeGreaterThan(0);
    const row = rows.find((r) => String(r.workId) === String(WORK_ID));
    expect(row, `a row for work ${WORK_ID}`).toBeTruthy();
    expect(row.seconds).toBeGreaterThan(0);
    expect(row.trackId.startsWith(`${WORK_ID}/`), 'trackId is workId/relPath').toBe(true);
    expect(typeof row.observedAt, 'observedAt is epoch ms').toBe('number');

    // Reload and confirm the tree shows a saved position for that track.
    await page.reload();
    await page.waitForSelector('.q-item', { timeout: 15000 });
    const after = await positionRows(page);
    const restored = after.find((r) => r.trackId === row.trackId);
    expect(restored, 'the row survived the reload').toBeTruthy();
    expect(restored.seconds).toBeGreaterThanOrEqual(row.seconds);
  });

  // The point of the local store: the server is pushed at most once a minute
  // during continuous playback, where it used to be every 10 seconds.
  test('the server is not pushed on every local tick', async ({ page }) => {
    const pushes = [];
    await page.route('**/api/track-progress/**', (route) => {
      pushes.push(route.request().url());
      return route.continue();
    });

    await page.goto(`${BASE}/work/${WORK_ID}`);
    await page.waitForSelector('.q-item', { timeout: 15000 });
    await page.locator('.q-item').filter({ hasText: /\.(mp3|opus|flac|wav|m4a|webm)$/i }).first().click();

    // ~35s of uninterrupted playback: three local ticks, and the initial
    // state-change push but no periodic one yet.
    await page.waitForTimeout(35000);

    const rows = await positionRows(page);
    expect(rows.length, 'local writes happened').toBeGreaterThan(0);
    expect(pushes.length, `server pushes in 35s (was ~3 before throttling): ${pushes.length}`)
      .toBeLessThanOrEqual(2);
  });
});
