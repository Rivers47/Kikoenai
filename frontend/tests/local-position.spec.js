import { test, expect } from '@playwright/test';

// Playback position is written to IndexedDB on this device, so a reload restores
// it without the server having been told. These drive a real browser because
// that is the only way to exercise IndexedDB and the 60s server throttle.
//
// Needs a running app with a scanned library. The dev server is enough -- these
// touch only the API and IndexedDB, no service worker -- so the config's default
// baseURL applies; override with KIKO_TEST_BASE_URL to run against a build.
// KIKO_TEST_WORK_ID must name a work with at least one audio track.
//
// If the server has auth on, set KIKO_TEST_USER and KIKO_TEST_PASSWORD; without
// them the run assumes auth is off. Logging in beats turning auth off to test,
// which leaves the authenticated paths untested.
const BASE = process.env.KIKO_TEST_BASE_URL || 'http://localhost:8080';
const WORK_ID = process.env.KIKO_TEST_WORK_ID || '000001';
const USER = process.env.KIKO_TEST_USER;
const PASSWORD = process.env.KIKO_TEST_PASSWORD;

// The session is an HttpOnly cookie (boot/axios.js). page.request shares the
// context's cookie jar, so one API login covers every later page.goto.
test.beforeEach(async ({ page }) => {
  if (!USER) return;
  const res = await page.request.post(`${BASE}/api/auth/me`, {
    data: { name: USER, password: PASSWORD }
  });
  expect(res.ok(), `login as ${USER} failed: ${res.status()}`).toBe(true);
});

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

// Scope every lookup to the tree: the left drawer is also a q-list of q-items,
// and two of its rows (shuffle, dark mode) hold a q-btn, so an unscoped
// "q-item containing a button" happily matches the shuffle toggle.
const TREE = '#work-tree';

// An audio row is the only kind with a play button in its avatar slot -- every
// other type renders a q-icon instead (WorkTree.vue). Matching on the label text
// does not work: it shows `trackTitle || title`, so a work with scraped track
// names has no filename on screen at all.
const audioRows = (page) => page.locator(`${TREE} .q-item`).filter({ has: page.locator('.q-btn') });

// Folder rows carry a material-icons glyph whose text is literally "folder".
const folderRows = (page) => page.locator(`${TREE} .q-item`)
  .filter({ has: page.locator('i.q-icon', { hasText: /^folder$/ }) });

/**
 * Open the work and start its first audio track, descending into folders if the
 * root holds none -- plenty of works keep every track in a subfolder, so a test
 * that only looks at the root passes or fails on which work it was pointed at.
 *
 * No tab to select: Work.vue renders the tab bar only when the work has a
 * scraped description, and files is the default panel either way.
 */
async function startFirstAudioTrack (page, workId, maxDepth = 4) {
  await page.goto(`${BASE}/work/${workId}`);
  await page.waitForSelector(`${TREE} .q-item`, { timeout: 15000 });

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (await audioRows(page).count() > 0) {
      // Clicking the row plays it, same as the play button (onClickItem).
      await audioRows(page).first().click();
      return;
    }
    const folders = folderRows(page);
    if (await folders.count() === 0) break;
    await folders.first().click();
    await page.waitForTimeout(500);
  }

  throw new Error(
    `no audio track found in work ${workId} within ${maxDepth} folder levels -- `
    + 'set KIKO_TEST_WORK_ID to a work that has one'
  );
}

test.describe('local-first playback position', () => {
  test('a played track is recorded locally and survives a reload', async ({ page }) => {
    // Start playing, then let the 10s local tick fire.
    await startFirstAudioTrack(page, WORK_ID);
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
    await page.waitForSelector(`${TREE} .q-item`, { timeout: 15000 });
    const after = await positionRows(page);
    const restored = after.find((r) => r.trackId === row.trackId);
    expect(restored, 'the row survived the reload').toBeTruthy();
    expect(restored.seconds).toBeGreaterThanOrEqual(row.seconds);
  });

  // The point of the local store: the server is pushed at most once a minute
  // during continuous playback, where it used to be every 10 seconds.
  test('the server is not pushed on every local tick', async ({ page }) => {
    // 35s of waiting plus navigation does not fit the default 60s budget.
    test.setTimeout(120000);
    const pushes = [];
    await page.route('**/api/track-progress/**', (route) => {
      pushes.push(route.request().url());
      return route.continue();
    });

    await startFirstAudioTrack(page, WORK_ID);

    // ~35s of uninterrupted playback: three local ticks, and the initial
    // state-change push but no periodic one yet.
    await page.waitForTimeout(35000);

    const rows = await positionRows(page);
    expect(rows.length, 'local writes happened').toBeGreaterThan(0);
    expect(pushes.length, `server pushes in 35s (was ~3 before throttling): ${pushes.length}`)
      .toBeLessThanOrEqual(2);
  });
});
