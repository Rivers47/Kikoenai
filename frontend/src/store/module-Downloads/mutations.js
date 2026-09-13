import { LocalStorage } from 'quasar'
import { DOWNLOADED_FILES_KEY } from './state'
import { cacheKeyFor } from '../../utils/downloads'

const mutations = {
  // file: { url, workId, trackId, type, title, workTitle, bytes, downloadedAt }
  ADD_DOWNLOADED_FILE (state, file) {
    state.downloadedFiles = state.downloadedFiles.filter(f => f.url !== file.url)
    state.downloadedFiles.push(file)
    LocalStorage.set(DOWNLOADED_FILES_KEY, state.downloadedFiles)
  },

  REMOVE_DOWNLOADED_FILE (state, url) {
    state.downloadedFiles = state.downloadedFiles.filter(f => f.url !== url)
    LocalStorage.set(DOWNLOADED_FILES_KEY, state.downloadedFiles)
  },

  // Bulk remove, for discarding a whole work's rows at once (a failed or
  // aborted Background Fetch, or a reconcile pass finding files that never
  // landed). One LocalStorage write instead of one per file.
  REMOVE_DOWNLOADED_FILES (state, urls) {
    // Normalized like PROMOTE below. Every caller passes the raw manifest form
    // today, so this is not currently load-bearing -- but a removal that silently
    // matches nothing leaves an orphan row claiming a file is downloaded, and the
    // two mutations disagreeing about URL spelling is exactly how that happens.
    const removing = new Set(urls.map(cacheKeyFor))
    state.downloadedFiles = state.downloadedFiles.filter(f => !removing.has(cacheKeyFor(f.url)))
    LocalStorage.set(DOWNLOADED_FILES_KEY, state.downloadedFiles)
  },

  // Marks pending rows as really downloaded once their bytes are in Cache
  // Storage. `promoted` is [{ url, bytes }] -- from the service worker's
  // completion message, or from reconcileDownloads on boot.
  PROMOTE_DOWNLOADED_FILES (state, promoted) {
    // Matched through cacheKeyFor, not on raw strings: the worker reports a
    // percent-encoded pathname while the manifest holds the raw one, and since
    // trackIds became `workId/relPath` those differ for any track with a space
    // or a non-ASCII character -- i.e. almost all of them.
    const byUrl = new Map(promoted.map(p => [cacheKeyFor(p.url), p]))
    state.downloadedFiles = state.downloadedFiles.map(f => {
      const hit = byUrl.get(cacheKeyFor(f.url))
      if (!hit) return f
      const promoted = {
        ...f,
        bytes: hit.bytes || f.bytes || 0,
        downloadedAt: f.downloadedAt || Date.now(),
      }
      delete promoted.pending
      return promoted
    })
    LocalStorage.set(DOWNLOADED_FILES_KEY, state.downloadedFiles)
  },

  SET_ENABLE_TRANSCODING (state, value) {
    state.enableTranscoding = value
  },
}

export default mutations
