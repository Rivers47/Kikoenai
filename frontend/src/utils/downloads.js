// Offline-download orchestration: fetches a file and stores it in the service
// worker's Cache Storage bucket so it can be served offline (see the
// 'offline-tracks' runtimeCaching routes in quasar.config.js). Vuex
// (store/module-Downloads) only holds the manifest of what's been downloaded --
// the actual bytes live in Cache Storage, not in the store.
const CACHE_NAME = 'offline-tracks'

// Fetches `url` and stores the response in the offline cache. Must be a plain
// fetch() with no Range header so the cached entry is a full 200 response --
// RangeRequestsPlugin (registered on the SW route) can only slice a complete
// cached response into 206s, not extend a partial one.
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
        })
      }
    }
  }
  walk(tree)
  return files
}
