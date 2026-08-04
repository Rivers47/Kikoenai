const getters = {
  currentPlayingFile: (state) => {
    return state.queue[state.queueIndex] || {
      trackId: '',
      title: '',
      workTitle: ''
    }
  },

  resumeHistoryDone: (state) => {
    return state.resumeHistorySeconds < 0
  },

  isQueueEmpty: (state) => {
    return state.queue.length == 0
  },
}

export default getters