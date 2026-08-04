import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:8080';
const VA1_ID = '2f4d41d5-ab24-5601-99d9-961e39bf180a';
const VA2_ID = '83a442aa-3662-5e17-aece-757bc3cb97cd';

//This test doesn't really work due to browser BFcache behavior difference.
test.describe('Works page state management', () => {
  test('TC1: back from work detail to same VA preserves scroll', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(2000);
    // Initial full load (SPA initializes)
    await page.goto(`${BASE}/?vaId=${VA1_ID}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('a[href^="/work/"]', { timeout: 15000 });
    console.log(`TC1: At works list: ${page.url()}`);
    await page.waitForTimeout(2000);
    
    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    console.log(`TC1: ScrollY before nav: ${scrollBefore}`);

    // SPA-internal navigation: click a work card link
    await page.locator('a[href^="/work/"]').first().click();
    await page.waitForTimeout(2000);
    console.log(`TC1: At work detail: ${page.url()}`);

    // Back navigation (popstate — SPA handles without reload)
    
    await page.goBack();
    await page.waitForTimeout(3000);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    console.log(`TC1: ScrollY after back: ${scrollAfter}`);

    // If SPA preserved state, scroll should be > 50
    expect(scrollAfter).toBeGreaterThan(50);
  });

  test('TC2: same-route VA change resets scroll', async ({ page }) => {
    await page.goto(`${BASE}/?vaId=${VA1_ID}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('a[href^="/work/"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    console.log(`TC2: Scroll before VA change: ${scrollBefore}`);

    // SPA-internal navigation: navigate to different VA via URL change
    // Use router.push via evaluate to avoid full page reload
    await page.evaluate((vaId) => {
      const app = document.querySelector('#q-app');
      if (app?.__vue_app__) {
        const router = app.__vue_app__.config.globalProperties.$router;
        if (router) router.push(`/?vaId=${vaId}`);
      }
    }, VA2_ID);
    await page.waitForTimeout(3000);

    const scrollAfter = await page.evaluate(() => window.scrollY);
    console.log(`TC2: Scroll after VA change: ${scrollAfter}`);
    expect(scrollAfter).toBeLessThan(50);
  });

  test('TC3: cross-page different VA resets scroll', async ({ page }) => {
    await page.goto(`${BASE}/?vaId=${VA1_ID}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('a[href^="/work/"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // SPA-internal navigation to work detail
    await page.locator('a[href^="/work/"]').first().click();
    await page.waitForTimeout(2000);

    // Navigate to different VA via Vue Router (SPA-internal, no reload)
    await page.evaluate((vaId) => {
      const app = document.querySelector('#q-app');
      if (app?.__vue_app__) {
        const router = app.__vue_app__.config.globalProperties.$router;
        if (router) router.push(`/?vaId=${vaId}`);
      }
    }, VA2_ID);
    await page.waitForTimeout(3000);

    const scrollY = await page.evaluate(() => window.scrollY);
    console.log(`TC3: Scroll after different VA: ${scrollY}`);
    expect(scrollY).toBeLessThan(50);
  });

  test('TC4: back from favourites to / preserves scroll', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('a[href^="/work/"]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(500);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    console.log(`TC4: ScrollY before: ${scrollBefore}`);

    // SPA-internal navigation: click favourites link in sidebar
    const favLink = page.locator('a[href="/favourites"]');
    await favLink.first().click();
    await page.waitForTimeout(2000);

    // Back navigation (popstate)
    await page.goBack();
    await page.waitForTimeout(3000);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    console.log(`TC4: ScrollY after back: ${scrollAfter}`);

    expect(scrollAfter).toBeGreaterThan(50);
  });
});