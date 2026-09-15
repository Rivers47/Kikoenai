// Offline-download orchestration: fetches a file and stores it in the service
// worker's Cache Storage bucket
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
 * Ask for persistent storage, or local storage is evicted non-deterministically.
 */
async function requestPersistentStorage () {
  if (!navigator.storage || !navigator.storage.persist) return
  try {
    if (await navigator.storage.persisted()) return
    if (!await navigator.storage.persist()) {
      console.warn('[kikoenai] persistent storage not granted; downloads and local positions may be evicted')
    }
  } catch (err) {
    console.error('persistent storage request failed:', err)
  }
}

export function cacheKeyFor (url) {
  const raw = String(url || '')
  try {
    return decodeURI(raw)
  } catch {
    return raw
  }
}

export async function cacheFile (url) {
  await requestPersistentStorage()
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
 */
export async function startWorkDownload ({ workId, workTitle, rows, title, onProgress }) {
  await requestPersistentStorage()
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
