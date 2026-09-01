import { LocalStorage, SessionStorage } from 'quasar'
import getters from './getters'
import state, { SWAP_SEEK_BUTTON_KEY, FLIP_LR_CHANNEL_KEY, ENABLE_PIP_LYRICS, AI_SERVER_URL_KEY, OLD_WORK_CARD_UI_STYLE_KEY, AUTO_MARK_LISTENED_KEY, REWIND_SEEK_TIME_KEY, FORWARD_SEEK_TIME_KEY, SLEEP_TIMER_KEY } from './state'
import { apiUrl } from 'src/base-path'

const mutations = {
  TOGGLE_HIDE (state) {
    state.hide = !state.hide
  },

  PLAY (state) {
    state.playing = true
  },
  PAUSE (state) {
    state.playing = false
  },
  TOGGLE_PLAYING (state) {
    state.playing = !state.playing
  },

  SET_NEW_CURRENT_TIME (state, value) {
    state.newCurrentTime = value;
  },

  // Play a specific file from the queue.
  SET_TRACK: (state, index) => {
    if (index >= state.queue.length || index < 0) {
      return; // Invalid index, bail.
    }

    state.playing = true
    state.queueIndex = index
  },
  NEXT_TRACK: (state) => {
    if (state.queueIndex < state.queue.length - 1) {
      // Go to next track only if it exists.
      state.playing = true
      state.queueIndex += 1
    }
  },
  PREVIOUS_TRACK: (state) => {
    if (state.queueIndex > 0) {
      // Go to previous track only if it exists.
      state.playing = true
      state.queueIndex -= 1
    }
  },

  SET_QUEUE (state, payload) {
    state.queue = payload.queue
    state.queueIndex = payload.index

    if (payload.resetPlaying) {
      state.playing = true
    }

    const workId = payload.workId
    // 设置workId，然后配置封面，从浏览器本地Storage查找是否曾经手动配置过封面，
    // 如果没有则使用默认的封面路径
    if (workId !== state.playWorkId) {
      const localStorageName = `visual_cover_${workId}`
      let coverUrl = LocalStorage.getItem(localStorageName)
      if (!coverUrl) {
        const file = getters.currentPlayingFile(state)
        const trackId = file.trackId || file.hash
        coverUrl = apiUrl(`/api/cover/${trackId.split('/')[0]}`)
      }
      state.visualPlayerCoverUrl = coverUrl
    }
    state.playWorkId = workId
    state.playWorkVas = payload.vas || []
    state.workLastTrackId = payload.workLastTrackId || ''
    if (Object.prototype.hasOwnProperty.call(payload, "resumeHistorySeconds")) {
      // Normalize here rather than at each call site. -1 is the "nothing to
      // resume" sentinel, and the resumeHistoryDone getter tests `< 0` --
      // `undefined < 0` is false, so an undefined leaking through left the
      // player believing a resume was forever pending, which silently disabled
      // both history writes and per-track progress reporting for the session.
      // History rows carry no `seconds` of their own (PUT /api/history sends
      // only { queue, index }); it is resolved server-side from
      // t_track_progress, and stays undefined when that lookup misses.
      const seconds = Number(payload.resumeHistorySeconds)
      state.resumeHistorySeconds = Number.isFinite(seconds) ? seconds : -1
    }
  },
  EMPTY_QUEUE: (state) => {
    state.playing = false
    state.queue = []
    state.queueIndex = 0
    state.playWorkVas = []
    state.workLastTrackId = ''
  },
  ADD_TO_QUEUE: (state, file) => {
    state.queue.push(file)
  },
  REMOVE_FROM_QUEUE: (state, index) => {
    state.queue = state.queue.filter((_, i) => i !== index)

    if (index === state.queueIndex) {
      state.playing = false
      state.queueIndex = 0
    } else if (index < state.queueIndex) {
      state.queueIndex -= 1
    }
  },


  SET_DURATION (state, second) {
    state.duration = second
  },

  SET_CURRENT_TIME (state, second) {
    state.currentTime = second
  },

  // Add a file after the current playing item in the queue.
  PLAY_NEXT: (state, file) => {
    state.queue.splice(state.queueIndex + 1, 0, file);
  },

  CHANGE_PLAY_MODE: (state) => {
    const playModes = [
      {
        id: 0,
        name: "order"
      },
      {
        id: 1,
        name: "all repeat"
      },
      {
        id: 2,
        name: "repeat once"
      },
      {
        id: 3,
        name: "shuffle"
      }
    ]
    const index = (state.playMode.id >= playModes.length - 1) ? 0 : (state.playMode.id + 1)

    state.playMode = playModes[index]
  },

  TOGGLE_MUTED: (state) => {
    state.muted = !state.muted
  },

  SET_VOLUME: (state, val) => {
    if (val < 0 || val > 1) {
      return
    }
    state.volume = val
  },
  SET_REWIND_SEEK_TIME: (state, value) => {
    state.rewindSeekTime = value
    LocalStorage.set(REWIND_SEEK_TIME_KEY, value)
  },
  SET_FORWARD_SEEK_TIME: (state, value) => {
    state.forwardSeekTime = value
    LocalStorage.set(FORWARD_SEEK_TIME_KEY, value)
  },
  SET_REWIND_SEEK_MODE: (state, value) => {
    state.rewindSeekMode = value
  },
  SET_FORWARD_SEEK_MODE: (state, value) => {
    state.forwardSeekMode = value
  },
  SET_HAS_LYRIC: (state, value) => {
    state.hasLyric = value;
  },
  SET_CURRENT_LYRICS: (state, lines) => {
    state.currentLyrics = lines
  },
  SET_LYRIC_SPEAKERS: (state, names) => {
    state.lyricSpeakers = names
  },
  SET_LYRIC_OFFSET_SECONDS: (state, value) => {
    state.lyricOffsetSeconds = value;
  },
  // payload: { type: 'minutes', stopAt: <ms 时间戳> } 或 { type: 'tracks', tracksLeft: <int> }
  SET_SLEEP_TIMER: (state, { type, stopAt = null, tracksLeft = 0 }) => {
    state.sleepMode = true
    state.sleepModeType = type
    state.sleepStopAt = type === 'minutes' ? stopAt : null
    state.sleepTracksLeft = type === 'tracks' ? tracksLeft : 0
    SessionStorage.set(SLEEP_TIMER_KEY, { type, stopAt: state.sleepStopAt, tracksLeft: state.sleepTracksLeft })
  },

  DECREMENT_SLEEP_TRACKS: (state) => {
    if (state.sleepTracksLeft > 0) {
      state.sleepTracksLeft -= 1
      if (state.sleepMode && state.sleepModeType === 'tracks') {
        SessionStorage.set(SLEEP_TIMER_KEY, { type: 'tracks', stopAt: null, tracksLeft: state.sleepTracksLeft })
      }
    }
  },

  CLEAR_SLEEP_MODE: (state) => {
    state.sleepMode = false
    state.sleepModeType = null
    state.sleepStopAt = null
    state.sleepTracksLeft = 0
    SessionStorage.remove(SLEEP_TIMER_KEY)
  },

  SET_VISUAL_PLAYER_COVER_URL: (state, value) => {
    const localStorageName = `visual_cover_${state.playWorkId}`
    state.visualPlayerCoverUrl = value
    LocalStorage.set(localStorageName, state.visualPlayerCoverUrl)
  },

  // SET_AUDIO_ELEMENT: (state, value) => {
  //   state.audioElement = value
  // }
  
  SET_SWAP_SEEK_BUTTON: (state, value) => {
    state.swapSeekButton = value
    LocalStorage.set(SWAP_SEEK_BUTTON_KEY, state.swapSeekButton)
  },

  SET_FLIP_LR_CHANNEL: (state, value) => {
    state.flipLRChannel = value
    LocalStorage.set(FLIP_LR_CHANNEL_KEY, state.flipLRChannel)
  },

  SET_ENABLE_PIP_LYRICS: (state, value) => {
    state.enablePIPLyrics = value
    LocalStorage.set(ENABLE_PIP_LYRICS, state.enablePIPLyrics)
  },

  SET_RESUME_HISTORY_SECONDS: (state, value) => {
    state.resumeHistorySeconds = value
  },

  RESUME_HISTORY_SECONDS_DONE: (state) => {
    state.resumeHistorySeconds = -1
  },

  SET_OLD_WORK_CARD_UI_STYLE: (state, value) => {
    state.oldWorkCardUIStyle = value
    LocalStorage.set(OLD_WORK_CARD_UI_STYLE_KEY, value)
  },

  SET_AUTO_MARK_LISTENED: (state, value) => {
    state.autoMarkListened = value
    LocalStorage.set(AUTO_MARK_LISTENED_KEY, value)
  },
}

export default mutations