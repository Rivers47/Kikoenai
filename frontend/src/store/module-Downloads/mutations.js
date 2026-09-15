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

  REMOVE_DOWNLOADED_FILES (state, urls) {
    const removing = new Set(urls.map(cacheKeyFor))
    state.downloadedFiles = state.downloadedFiles.filter(f => !removing.has(cacheKeyFor(f.url)))
    LocalStorage.set(DOWNLOADED_FILES_KEY, state.downloadedFiles)
  },

  // Marks pending rows as really downloaded once their bytes are in Cache
  // Storage. `promoted` is [{ url, bytes }] -- from the service worker's
  // completion message, or from reconcileDownloads on boot.
  PROMOTE_DOWNLOADED_FILES (state, promoted) {
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
