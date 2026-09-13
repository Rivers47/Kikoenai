// Offline-download orchestration: fetches a file and stores it in the service
// worker's Cache Storage bucket so it can be served offline (see the caching
// routes in src-pwa/custom-service-worker.js). Vuex (store/module-Downloads)
// only holds the manifest of what's been downloaded -- the actual bytes live in
// Cache Storage, not in the store.
//
// Two download paths exist:
//   - per-track  -> cacheFile(), a plain foreground fetch. Small and immediate;
//                   dies if the tab closes, which is acceptable for one track.
//   - whole-work -> startWorkDownload(), Background Fetch. Survives tab close,
//                   resumes across network drops, completes in the service
//                   worker. Chromium only -- canBackgroundFetch() picks the
//                   foreground path everywhere else.
import { apiUrl, appUrl } from '../base-path'
import { activeRegistration } from './service-worker'

const CACHE_NAME = 'offline-tracks'

/**
 * One spelling for a cached URL, so two producers cannot disagree about it.
 *
 * The manifest stores what apiUrl() produced -- a raw path, which since trackIds
 * became `workId/relPath` contains spaces and unicode. The service worker reports
 * `new URL(record.request.url).pathname`, which is percent-**encoded**. Comparing
 * those as strings silently matched nothing, so a finished whole-work download
 * never promoted its rows and the button stayed on "downloading" until a reload
 * (reconcileDownloads happened to work, because cache.match normalizes URLs).
 *
 * Decode rather than encode: the manifest key is local state, not a wire format,
 * and the raw form is what every other caller already builds. A filename holding
 * a literal `%` makes decodeURI throw, so fall back to the input.
 */
export function cacheKeyFor (url) {
  const raw = String(url || '')
  try {
    return decodeURI(raw)
  } catch {
    return raw
  }
}

export async function cacheFile (url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`download failed: ${url} (${response.status})`)
  }
  const bytes = (await response.clone().blob()).size
  const cache = await caches.open(CACHE_NAME)
  await cache.put(url, response)
  return bytes
}

export async function uncacheFile (url) {
  const cache = await caches.open(CACHE_NAME)
  await cache.delete(url)
}

// Walks a /api/tracks/:id tree (nested by folder, per toTree() on the
// backend) and flattens it to the audio/lyric leaf nodes a work-level
// download needs to fetch. Mirrors the extension grouping the backend's
// /api/media/offline route uses -- 'text' nodes there are exactly the
// .txt/.lrc/.srt/.ass/.vtt files that route serves as-is.
export function collectDownloadableFiles (tree) {
  const files = []
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        walk(node.children)
      } else if (node.type === 'audio' || node.type === 'text') {
        files.push({
          trackId: node.trackId,
          title: node.title,
          type: node.type === 'audio' ? 'audio' : 'lyric',
          // Carried so a queue built from the manifest can show a track length
          // -- offline there is no tree to read it from. trackId doubles as the
          // progress key, so nothing else is needed to report position.
          duration: node.duration,
        })
      }
    }
  }
  walk(tree)
  return files
}

export const BG_FETCH_ID_PREFIX = 'kikoenai-work-'

export const bgFetchIdFor = (workId) => `${BG_FETCH_ID_PREFIX}${workId}`

/**
 * Whether a whole-work download can be handed to the browser.
 *
 * Two conditions, and the second is the one that used to be missed: the API can
 * exist while no worker is there to own the fetch. Chromium-only either way --
 * everywhere else this is false and the foreground path runs instead.
 */
export async function canBackgroundFetch () {
  if (!('BackgroundFetchManager' in self)) return false
  const registration = await activeRegistration()
  return !!registration && 'backgroundFetch' in registration
}

// Every file a work needs to be fully usable offline: audio tracks, lyric and
// subtitle files, all three cover variants, and the JSON the work-detail page
// renders from.
export function buildWorkDownloadPlan (workId, tree) {
  const files = collectDownloadableFiles(tree)
  const rows = files.map(file => ({
    url: apiUrl(`/api/media/offline/${file.trackId}`),
    trackId: file.trackId,
    type: file.type,
    title: file.title,
    duration: file.duration,
  }))

  for (const url of [
    apiUrl(`/api/cover/${workId}?type=main`),
    apiUrl(`/api/cover/${workId}`),
    apiUrl(`/api/cover/${workId}?type=sam`),
  ]) {
    rows.push({ url, trackId: null, type: 'cover', title: 'cover' })
  }

  const metadataUrls = [
    apiUrl(`/api/work/${workId}`),
    apiUrl(`/api/tracks/${workId}`),
    apiUrl(`/api/review?work_id=${workId}`),
  ]

  for (const file of files) {
    if (file.type === 'audio') metadataUrls.push(apiUrl(`/api/media/check-lrc/${file.trackId}`))
  }

  for (const url of metadataUrls) {
    rows.push({ url, trackId: null, type: 'metadata', title: url })
  }

  return rows
}

/**
 * Fetch a work's files in the page, for engines without Background Fetch.
 *
 * The trade against the background path is the tab: this runs in the page, so
 * navigating away or closing it abandons the download. The caller tells the user
 * so. `reconcileDownloads` cleans up the rows afterwards either way.
 *
 * Serial rather than parallel, deliberately: progress is what the user watches
 * instead of an OS notification, and N-at-a-time makes "12 of 43" meaningless.
 *
 * All-or-nothing on failure, matching Background Fetch's own semantics (any
 * non-2xx record discards the batch). That keeps `isWorkDownloaded` honest --
 * it is keyed on the metadata rows being promoted, so a half-cached work must
 * not look complete. See the note in frontend/AGENTS.md §3.
 */
export async function downloadWorkInForeground ({ rows, onProgress }) {
  const stored = []
  try {
    for (const [index, row] of rows.entries()) {
      const bytes = await cacheFile(row.url)
      stored.push({ url: row.url, bytes })
      onProgress?.({ done: index + 1, total: rows.length })
    }
  } catch (err) {
    // Undo the partial download rather than leave bytes nothing references.
    for (const done of stored) {
      try {
        await uncacheFile(done.url)
      } catch {
        // Already gone, or the cache is unavailable; nothing useful to do.
      }
    }
    throw err
  }
  return { mode: 'foreground', stored }
}

/**
 * Start a whole-work download by whichever route this browser supports.
 *
 * `mode` tells the caller which happened, because the two differ in ways the UI
 * has to reflect: 'background' finishes in the service worker and promotes its
 * rows by message, possibly with no tab open, while 'foreground' has already
 * finished by the time this resolves and hands back its `stored` list directly.
 */
export async function startWorkDownload ({ workId, workTitle, rows, title, onProgress }) {
  if (!(await canBackgroundFetch())) {
    return downloadWorkInForeground({ rows, onProgress })
  }

  const registration = await activeRegistration()
  const existing = await registration.backgroundFetch.get(bgFetchIdFor(workId))
  if (existing) {
    throw new Error(`[kikoenai] a download for ${workId} is already running`)
  }

  await registration.backgroundFetch.fetch(
    bgFetchIdFor(workId),
    rows.map(row => row.url),
    {
      title: title || workTitle || workId,
      icons: [{ src: appUrl('/icons/icon-192x192.png'), sizes: '192x192', type: 'image/png' }],
    }
  )
  return { mode: 'background' }
}

export async function reconcileDownloads (downloadedFiles) {
  const pending = downloadedFiles.filter(f => f.pending)
  if (pending.length === 0) return { promote: [], drop: [] }

  // A fetch still in flight has legitimately not written its files yet --
  // dropping those rows would delete a download in progress.
  //
  // Not serviceWorker.ready: with no active worker that never settles, and this
  // runs on boot, so reconcile would silently never happen. No worker also means
  // no Background Fetch can be running, so an empty set is the right answer --
  // which is exactly the case on engines using the foreground path.
  const registration = await activeRegistration()
  const activeIds = registration && 'backgroundFetch' in registration
    ? await registration.backgroundFetch.getIds()
    : []
  const activeWorkIds = new Set(
    activeIds
      .filter(id => id.startsWith(BG_FETCH_ID_PREFIX))
      .map(id => id.slice(BG_FETCH_ID_PREFIX.length))
  )

  const cache = await caches.open(CACHE_NAME)
  const promote = []
  const drop = []

  for (const file of pending) {
    if (activeWorkIds.has(String(file.workId))) continue

    const response = await cache.match(file.url)
    if (!response) {
      drop.push(file.url)
      continue
    }
    promote.push({
      url: file.url,
      bytes: file.bytes || Number(response.headers.get('content-length')) || 0,
    })
  }

  return { promote, drop }
}

// Subscribes to the completion messages posted by the service worker. Returns
// an unsubscribe function. `handlers` takes { onSuccess, onFail, onAbort }.
export function onDownloadMessage (handlers) {
  const listener = (event) => {
    const data = event.data
    if (!data || typeof data.type !== 'string') return

    switch (data.type) {
      case 'kikoenai/download-success':
        handlers.onSuccess?.(data.workId, data.stored)
        break
      case 'kikoenai/download-fail':
        handlers.onFail?.(data.workId)
        break
      case 'kikoenai/download-abort':
        handlers.onAbort?.(data.workId)
        break
    }
  }

  navigator.serviceWorker.addEventListener('message', listener)
  return () => navigator.serviceWorker.removeEventListener('message', listener)
}
