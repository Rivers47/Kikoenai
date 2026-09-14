const getters = {
  currentPlayingFile: (state) => {
    return state.queue[state.queueIndex] || {
      trackId: '',
      title: '',
      workTitle: ''
    }
  },

  // Keyed to a track: switching tracks before the resume lands must not carry
  // its position over to the new one.
  resumeHistoryDone: (state) => {
    return state.resumeHistorySeconds < 0
      || state.resumeHistoryTrackId !== getters.currentPlayingFile(state).trackId
  },

  isQueueEmpty: (state) => {
    return state.queue.length == 0
  },
}

export default getters