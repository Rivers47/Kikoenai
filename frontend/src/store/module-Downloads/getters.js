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

  // True only when a *whole-work* download completed -- not when the user has
  // grabbed individual tracks from the work's tree. Keyed on 'metadata'
  // because WorkDetails' toggleWorkOfflineDownload commits those entries last,
  // after every track and the cover, so their presence doubles as a
  // completion marker (a run that fails partway leaves none, and the button
  // correctly still offers to download).
  //
  // Do NOT key this on 'audio': per-track downloads carry the same workId, so
  // a single downloaded track would flip the work-level button to "remove"
  // and leave no way to download the rest of the work.
  isWorkDownloaded: (state) => (workId) => {
    return state.downloadedFiles.some(f => f.workId === workId && f.type === 'metadata')
  },

  totalDownloadedBytes: (state) => {
    return state.downloadedFiles.reduce((sum, f) => sum + (f.bytes || 0), 0)
  },
}

export default getters
