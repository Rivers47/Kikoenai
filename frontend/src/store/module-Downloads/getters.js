// A row with `pending: true` has been written to the manifest but its bytes are
// not in Cache Storage yet -- a Background Fetch is still running, or finished
// while the app was closed and has not been reconciled. Every getter below
// ignores pending rows, so a work counts as downloaded only once it really is.
// This matters most for isDownloaded: AudioElement switches playback to the
// offline URL when it returns true, which would fail offline if the file were
// still in flight.
const isReady = (f) => !f.pending

const getters = {
  // Only 'audio' entries count as a "downloaded track" -- lyric/cover/metadata
  // entries are bookkeeping for a work's other offline files, not something a
  // user toggles per-track.
  isDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.trackId === trackId && f.type === 'audio')
  },

  // Unlike isDownloaded, matches any file type -- used for lyric/subtitle
  // files, which have their own trackId distinct from the audio track's.
  isFileDownloaded: (state) => (trackId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.trackId === trackId)
  },

  // True only when a *whole-work* download completed -- not when the user has
  // grabbed individual tracks from the work's tree. Keyed on 'metadata'
  // because those rows are committed last and promoted last, so their presence
  // in a non-pending state doubles as a completion marker (a run that fails
  // partway leaves none, and the button correctly still offers to download).
  //
  // Do NOT key this on 'audio': per-track downloads carry the same workId, so
  // a single downloaded track would flip the work-level button to "remove"
  // and leave no way to download the rest of the work.
  isWorkDownloaded: (state) => (workId) => {
    return state.downloadedFiles.some(f => isReady(f) && f.workId === workId && f.type === 'metadata')
  },

  // True while a whole-work Background Fetch is still in flight, so the UI can
  // show progress instead of offering to download again.
  isWorkDownloading: (state) => (workId) => {
    return state.downloadedFiles.some(f => f.pending && f.workId === workId)
  },

  totalDownloadedBytes: (state) => {
    return state.downloadedFiles.reduce((sum, f) => sum + (isReady(f) ? (f.bytes || 0) : 0), 0)
  },
}

export default getters
