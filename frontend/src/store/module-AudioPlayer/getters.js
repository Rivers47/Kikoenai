const getters = {
  currentPlayingFile: (state) => {
    return state.queue[state.queueIndex] || {
      trackId: '',
      title: '',
      workTitle: ''
    }
  },

  isQueueEmpty: (state) => {
    return state.queue.length == 0
  },
}

export default getters