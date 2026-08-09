import { LocalStorage } from 'quasar'
import { DOWNLOADED_FILES_KEY } from './state'

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

  SET_ENABLE_TRANSCODING (state, value) {
    state.enableTranscoding = value
  },
}

export default mutations
