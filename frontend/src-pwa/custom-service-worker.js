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
import { drain, SYNC_TAG } from '../src/utils/outbox'
import { appUrl, stripBasePath } from '../src/base-path'

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

//Must stay in sync with CACHE_NAME in src/utils/downloads.js
const OFFLINE_CACHE = 'offline-tracks'

const sameOrigin = (url) => url.origin === self.location.origin

const appPath = (url) => stripBasePath(url.pathname)

registerRoute(
  new NavigationRoute(createHandlerBoundToURL(process.env.PWA_FALLBACK_HTML), {
    denylist: [
      /\/api\//,
      /\/media\//,
      new RegExp(process.env.PWA_SERVICE_WORKER_REGEX),
      /workbox-(.)*\.js$/
    ]
  })
)

registerRoute(
  ({ url }) => sameOrigin(url) && appPath(url).startsWith('/api/media/offline/'),
  new CacheFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true },
    plugins: [new RangeRequestsPlugin()]
  })
)

registerRoute(
  ({ url }) => sameOrigin(url) && appPath(url).startsWith('/api/cover/'),
  new CacheFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true }
  })
)

const WORK_DATA_PATH = /^\/api\/(work|tracks)\/[^/]+$|^\/api\/review$/
registerRoute(
  ({ url }) => sameOrigin(url) && WORK_DATA_PATH.test(appPath(url)),
  new NetworkFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true }
  })
)

registerRoute(
  ({ url }) => sameOrigin(url) && appPath(url).startsWith('/api/media/check-lrc/'),
  new NetworkFirst({
    cacheName: OFFLINE_CACHE,
    matchOptions: { ignoreVary: true }
  })
)


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

async function storeFetchedRecords (registration) {
  const cache = await caches.open(OFFLINE_CACHE)
  const records = await registration.matchAll()
  const stored = []

  for (const record of records) {
    const response = await record.responseReady
    if (!response.ok) continue
    const bytes = Number(response.headers.get('content-length')) || 0
    await cache.put(record.request.url, response)
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

self.addEventListener('backgroundfetchfail', (event) => {
  const workId = workIdFromFetchId(event.registration.id)
  if (workId === null) return

  event.waitUntil(notifyClients({ type: 'kikoenai/download-fail', workId }))
})

self.addEventListener('backgroundfetchabort', (event) => {
  const workId = workIdFromFetchId(event.registration.id)
  if (workId === null) return

  event.waitUntil(notifyClients({ type: 'kikoenai/download-abort', workId }))
})

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
    await self.clients.openWindow(appUrl('/downloads'))
  })())
})

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return
  event.waitUntil(drain())
})
