/*
 * Custom service worker (Workbox InjectManifest mode).
 *
 * This file replaces the worker Workbox used to generate from the declarative
 * `runtimeCaching` config in quasar.config.js. The routes below are the same
 * ones, written out explicitly. The reason for the switch is that a generated
 * worker can only express routes -- it has no way to host event handlers such
 * as `backgroundfetchsuccess`, which the offline-download feature needs next.
 *
 * Build-time options (what ends up in the injected precache manifest) still
 * live in quasar.config.js under `extendInjectManifestOptions`. Runtime
 * behaviour lives here.
 */

import { clientsClaim } from 'workbox-core'
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL
} from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { RangeRequestsPlugin } from 'workbox-range-requests'

// Previously `opts.skipWaiting` / `opts.clientsClaim` in quasar.config.js.
// Quasar sets both by default in GenerateSW mode; in InjectManifest mode
// nothing is implicit, so they are declared here.
self.skipWaiting()
clientsClaim()

// `self.__WB_MANIFEST` is the precache list workbox-build injects at build
// time. The build fails if this reference is missing.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Single Cache Storage bucket shared by every offline-download route. Must
// stay in sync with CACHE_NAME in src/utils/downloads.js, which writes to the
// same bucket from the page.
const OFFLINE_CACHE = 'offline-tracks'

// Only ever handle our own origin. The previous regexes were implicitly
// same-origin because they were anchored at the start of the URL; the pathname
// matchers below are not, so the check is explicit.
const sameOrigin = (url) => url.origin === self.location.origin

/*
 * Navigation fallback: Vue Router owns every non-API route (the backend does
 * the same thing with connect-history-api-fallback). Previously
 * `navigateFallback` + `navigateFallbackDenylist`.
 *
 * The denylist entries are matched against `url.pathname + url.search`, which
 * is why these patterns are written unanchored against the origin.
 */
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(process.env.PWA_FALLBACK_HTML), {
    denylist: [
      /^\/api\//,
      /\/media\//,
      new RegExp(process.env.PWA_SERVICE_WORKER_REGEX),
      /workbox-(.)*\.js$/
    ]
  })
)

/*
 * Offline downloads.
 *
 * NOTE ON MATCHING: these three routes used to be RegExps in quasar.config.js
 * anchored as /^\/api\/.../ -- but Workbox's RegExpRoute execs the pattern
 * against the *absolute* URL (`url.href`, e.g. "https://host/api/..."), not
 * the pathname. A leading `^\/api\/` therefore never matched and all three
 * routes were dead. They are matched on `url.pathname` here instead.
 * (The NavigationRoute denylist above is unaffected -- NavigationRoute matches
 * on pathname, which is why navigation exclusion did work.)
 */

// Track and lyric files served by the offline-copy endpoint. Scoped narrowly
// to /api/media/offline/ -- never /api/media/stream/, so the original lossless
// stream never ends up in Cache Storage.
//
// RangeRequestsPlugin lets a full cached 200 response be sliced into the 206s
// an <audio> element asks for when seeking. In GenerateSW this was the
// `rangeRequests: true` shorthand, because importing the package from the
// Node-side config file crashed (it touches the SW global `self` at import
// time). Inside the worker that constraint is gone and the plugin is imported
// normally.
registerRoute(
  ({ url }) => sameOrigin(url) && url.pathname.startsWith('/api/media/offline/'),
  new CacheFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true },
    plugins: [new RangeRequestsPlugin()]
  })
)

// Cover images for downloaded works. Each cover variant (bare, ?type=main,
// ?type=sam) is its own cache entry -- see the cover-cache-keys note in
// frontend/CLAUDE.md.
registerRoute(
  ({ url }) => sameOrigin(url) && url.pathname.startsWith('/api/cover/'),
  new CacheFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true }
  })
)

// Work-detail page data (title/tags/track-tree/review). NetworkFirst, not
// CacheFirst: browsing any work -- downloaded or not -- should show live data
// whenever online, only falling back to the cached snapshot when the network is
// actually down. The explicit download action also seeds this cache directly so
// a downloaded work is navigable offline immediately, not only after having
// been viewed once online.
//
// `/api/review` carries its work id in the query string, which `url.pathname`
// excludes -- so the pathname match covers every review request.
const WORK_DATA_PATH = /^\/api\/(work|tracks)\/[^/]+$|^\/api\/review$/
registerRoute(
  ({ url }) => sameOrigin(url) && WORK_DATA_PATH.test(url.pathname),
  new NetworkFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true }
  })
)

/*
 * Background Fetch (Chromium only).
 *
 * Work-level downloads are handed to the browser as one batch instead of being
 * fetched file-by-file from the page. The browser downloads them even with no
 * tab open, then wakes this worker to move the results into OFFLINE_CACHE.
 *
 * The page writes its manifest rows up front with `pending: true` (it is the
 * only side that knows track titles), so this worker never has to invent
 * metadata -- it only moves bytes and reports which URLs landed. The page then
 * clears `pending`, either from the message below if it is open, or by
 * reconciling against this cache on next boot if it is not.
 *
 * Registration ids are `kikoenai-work-<workId>`; see BG_FETCH_ID_PREFIX in
 * src/utils/downloads.js.
 */

const BG_FETCH_ID_PREFIX = 'kikoenai-work-'

const workIdFromFetchId = (id) =>
  id.startsWith(BG_FETCH_ID_PREFIX) ? id.slice(BG_FETCH_ID_PREFIX.length) : null

// Tell every open tab what happened. There may be none -- that is the whole
// point of Background Fetch -- in which case the page reconciles on next boot.
async function notifyClients (message) {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  })
  for (const client of clientList) {
    client.postMessage(message)
  }
}

// Moves every successfully downloaded record into OFFLINE_CACHE.
//
// Background Fetch always delivers complete responses, never partials, so what
// lands here is exactly what RangeRequestsPlugin needs in order to slice 206s
// out of it later (the same reason cacheFile() must not send a Range header).
async function storeFetchedRecords (registration) {
  const cache = await caches.open(OFFLINE_CACHE)
  const records = await registration.matchAll()
  const stored = []

  for (const record of records) {
    const response = await record.responseReady
    if (!response.ok) continue
    // Read the size before cache.put() -- putting consumes the body, and
    // Content-Length avoids buffering a whole track into memory just to
    // measure it. Rows left at 0 get their size filled in by the page's
    // reconcile pass.
    const bytes = Number(response.headers.get('content-length')) || 0
    await cache.put(record.request.url, response)
    // Report the root-relative form the page's manifest is keyed on -- rows
    // are written as "/api/media/offline/<id>", not absolute URLs.
    const url = new URL(record.request.url)
    stored.push({ url: url.pathname + url.search, bytes })
  }

  return stored
}

self.addEventListener('backgroundfetchsuccess', (event) => {
  const workId = workIdFromFetchId(event.registration.id)
  if (workId === null) return

  event.waitUntil((async () => {
    const stored = await storeFetchedRecords(event.registration)
    await notifyClients({ type: 'kikoenai/download-success', workId, stored })
  })())
})

// A definitive failure -- Background Fetch already retries and resumes on its
// own, so reaching here means the download is not coming back. Drop whatever
// partial results exist rather than leaving a half-cached work: the page's
// isWorkDownloaded getter treats a work as downloaded only once its rows are
// no longer pending, and a partial run should offer to download again.
self.addEventListener('backgroundfetchfail', (event) => {
  const workId = workIdFromFetchId(event.registration.id)
  if (workId === null) return

  event.waitUntil(notifyClients({ type: 'kikoenai/download-fail', workId }))
})

// The user cancelled from the OS download UI.
self.addEventListener('backgroundfetchabort', (event) => {
  const workId = workIdFromFetchId(event.registration.id)
  if (workId === null) return

  event.waitUntil(notifyClients({ type: 'kikoenai/download-abort', workId }))
})

// Tapping the OS progress notification focuses an open tab, or opens the
// Downloads page if the app is not running.
self.addEventListener('backgroundfetchclick', (event) => {
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    })
    if (clientList.length > 0) {
      await clientList[0].focus()
      return
    }
    await self.clients.openWindow('/downloads')
  })())
})
