import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 60000,
  retries: 1,
  use: {
    // Default is the dev server (`npm run dev`), which proxies /api to :8888 --
    // enough for anything needing only the API and IndexedDB.
    //
    // Point KIKO_TEST_BASE_URL at a production build (`npm run build:prod` then
    // `npm start -w backend`, usually :8888) for anything touching the service
    // worker: offline navigation, Background Fetch, outbox drain. Dev has no
    // worker at all -- src-pwa/register-service-worker.js unregisters it so HMR
    // is not served stale from a cache.
    baseURL: process.env.KIKO_TEST_BASE_URL || 'http://localhost:8080',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});