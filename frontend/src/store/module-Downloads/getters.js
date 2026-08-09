const getters = {
  // Only 'audio' entries count as a "downloaded track" -- lyric/cover/metadata
  // entries are bookkeeping for a work's other offline files, not something a
  // user toggles per-track.
  isDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => f.trackId === trackId && f.type === 'audio')
  },

  // Unlike isDownloaded, matches any file type -- used for lyric/subtitle
  // files, which have their own trackId distinct from the audio track's.
  isFileDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => f.trackId === trackId)
  },

  isWorkDownloaded: (state) => (workId) => {
    return state.downloadedFiles.some(f => f.workId === workId && f.type === 'audio')
  },

  downloadedTracks: (state) => {
    return state.downloadedFiles.filter(f => f.type === 'audio')
  },

  totalDownloadedBytes: (state) => {
    return state.downloadedFiles.reduce((sum, f) => sum + (f.bytes || 0), 0)
  },
}

export default getters
