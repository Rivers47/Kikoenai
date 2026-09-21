const getters = {
  currentPlayingFile: (state) => {
    return state.queue[state.queueIndex] || {
      trackId: '',
      title: '',
      workTitle: ''
    }
  },

  // What to show for the playing track: the filled-in display name if the
  // work has one, otherwise the filename. Never use `title` directly for
  // display -- see backend/AGENTS.md 2.9b.
  currentPlayingTitle: (state, getters) => {
    const file = getters.currentPlayingFile;
    return file.trackTitle || file.title;
  },

  isQueueEmpty: (state) => {
    return state.queue.length == 0
  },
}

export default getters