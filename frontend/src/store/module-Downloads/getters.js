const isReady = (f) => !f.pending

const getters = {
  isDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.trackId === trackId && f.type === 'audio')
  },

  isFileDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.trackId === trackId)
  },

  // True only when a *whole-work* download completed
  isWorkDownloaded: (state) => (workId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.workId === workId && f.type === 'metadata')
  },

  // True while a whole-work Background Fetch is still in flight
  isWorkDownloading: (state) => (workId) => {
    return state.downloadedFiles.some(f => f.pending && f.workId === workId)
  },

  totalDownloadedBytes: (state) => {
    return state.downloadedFiles.reduce((sum, f) => sum + (isReady(f) ? (f.bytes || 0) : 0), 0)
  },
}

export default getters
