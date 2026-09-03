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
//                   worker. Chromium only -- see assertBackgroundFetchSupport.
import { apiUrl, appUrl } from '../base-path'

const CACHE_NAME = 'offline-tracks'

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
          trackId: node.trackId || node.hash,
          title: node.title,
          type: node.type === 'audio' ? 'audio' : 'lyric',
          // Carried so a queue built from the manifest can report progress and
          // show a track length -- offline there is no tree to read them from.
          contentHash: node.contentHash,
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

// No capability *detection* on purpose -- this branch targets Chromium and
// fails loudly on engines without the API, so a missing capability shows up as
// a named error rather than as silently different behaviour.
export function assertBackgroundFetchSupport () {
  if (!('BackgroundFetchManager' in self)) {
    throw new Error('[kikoenai] missing required API: BackgroundFetch')
  }
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
    contentHash: file.contentHash,
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

export async function startWorkDownload ({ workId, workTitle, rows, title }) {
  assertBackgroundFetchSupport()

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.backgroundFetch.get(bgFetchIdFor(workId))
  if (existing) {
    throw new Error(`[kikoenai] a download for ${workId} is already running`)
  }

  return registration.backgroundFetch.fetch(
    bgFetchIdFor(workId),
    rows.map(row => row.url),
    {
      title: title || workTitle || workId,
      icons: [{ src: appUrl('/icons/icon-192x192.png'), sizes: '192x192', type: 'image/png' }],
    }
  )
}

export async function reconcileDownloads (downloadedFiles) {
  const pending = downloadedFiles.filter(f => f.pending)
  if (pending.length === 0) return { promote: [], drop: [] }

  // A fetch still in flight has legitimately not written its files yet --
  // dropping those rows would delete a download in progress.
  const registration = await navigator.serviceWorker.ready
  const activeIds = await registration.backgroundFetch.getIds()
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
