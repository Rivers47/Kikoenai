<template>

  <!--在进度条周围监听mouseup、mousedown事件，辅助进度条状态切换-->
  <div class="q-px-md"
      @mousedown.capture="onPanSlider('start')"
      @mouseup.capture="onPanSlider('end')"
  >
    <div class="seek-undo-track relative-position">
      <q-slider v-model="changeCurrentTime"
        @change="onChangeSlider"
        @pan="onPanSlider"
        :min="0" :max="duration" :step="0.01"
        label
        :label-value="formatSeconds(displayCurrentTime)"
        />
      <!-- Ghost handle: where the undo pill would take you. -->
      <span
        v-if="seekUndoVisible"
        class="seek-undo-mark"
        :style="{ left: `${seekUndoPercent}%` }"
      />
    </div>

    <div ref="plyrContainer" style="display: none;">
      <!-- media src is managed imperatively (see _loadSource): a <source :src>
           binding only takes effect via media.load() and races with the
           nextTick-deferred watcher when Chrome freezes the hidden page -->
      <audio crossorigin="anonymous">
      </audio>
    </div>
  </div>
</template>

<script>
import { useI18n } from 'vue-i18n'
import { mapState, mapGetters, mapMutations } from 'vuex'
import NotifyMixin from '../mixins/Notification.js'
import { formatSeconds } from '../utils'
import { useSeekUndo } from 'src/utils/seek-undo'
import { MAX_LYRIC_STREAMS } from 'src/utils/lyrics'
import { parseLyricStreams, cueTextAt } from 'src/utils/subtitles'
import { sendOrQueue } from '../utils/outbox'
import { savePosition } from '../utils/positions'
import Plyr from 'plyr'
import { apiUrl, encodeTrackId } from 'src/base-path'

// Every media session action this component registers; teardown walks this
// list to unregister them one by one.
const MEDIA_SESSION_ACTIONS = [
  'play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward',
  'seekto'
]

const FINISHED_EPSILON_SECONDS = 1

// How often the lock-screen timeline is re-published while playing. The OS
// extrapolates the playhead from the last position state by itself, so this is
// only a drift/stall correction, not a per-frame sync.
const POSITION_STATE_REFRESH_MS = 1000

export default {
  setup () {
    const { t } = useI18n() // global scope
    const { visible, percent } = useSeekUndo()
    return { t, seekUndoVisible: visible, seekUndoPercent: percent }
  },
  name: 'AudioElement',

  mixins: [NotifyMixin],

  data() {
    return {
      plyr: null,

      isChangingCurrentTime: false,
      changeCurrentTime: 0,

      // 防止重复自动标记（同一次播放会话只提示一次）
      workMarkedComplete: false,
    }
  },

  computed: {
    source () {
      const trackId = this.currentPlayingFile.trackId
      if (this.currentPlayingFile.mediaStreamUrl) {
        return `${this.currentPlayingFile.mediaStreamUrl}`
      } else if (trackId && this.isDownloaded(trackId)) {
        // Once downloaded, always play from the offline copy
        return apiUrl(`/api/media/offline/${encodeTrackId(trackId)}`)
      } else if (trackId) {
        return apiUrl(`/api/media/stream/${encodeTrackId(trackId)}`)
      } else {
        return ""
      }
    },

    ...mapGetters('Downloads', ['isDownloaded', 'isFileDownloaded']),

    ...mapState('AudioPlayer', [
      'playing',
      'queue',
      'queueIndex',
      'playMode',
      'muted',
      'volume',
      'sleepMode',
      'sleepModeType',
      'sleepStopAt',
      'sleepTracksLeft',
      'rewindSeekTime',
      'forwardSeekTime',
      'rewindSeekMode',
      'forwardSeekMode',
      'playWorkId',
      'playWorkVas',
      'visualPlayerCoverUrl',
      'duration',
      'currentTime',
      'newCurrentTime',
      'lyricOffsetSeconds',
      'workLastTrackId',
      'autoMarkListened',
      'flipLRChannel',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'currentPlayingTitle',
    ]),

    displayCurrentTime() {
      if (this.isChangingCurrentTime) return this.changeCurrentTime;
      else return this.currentTime;
    }
  },

  watch: {
    playing (flag) {
      if (flag) {
        this.resumeAudioContext()
        // Advancing sets playing = true again (no-op) and swaps `source`,
        // whose watcher loads and plays the next track.
        if (this._advanceIfAtEndOfTrack()) return
      }
      if (this.plyr && this.plyr.duration) {
        // Only touch the element when it actually disagrees with the state.
        // Vue watchers are async, so a redundant play() from here lands a tick
        // after the lock-screen tap, outside its activation context. iOS then
        // leaves the element in a playing state whose clock never advances and
        // whose audio session is never reactivated: silent, frozen currentTime.
        if (flag) {
          if (this.plyr.paused) this.plyr.play().catch(() => {})
        } else if (!this.plyr.paused) {
          this.plyr.pause()
        }
      }
    },

    // swap L/R channels; graph persists once built, toggle rewires it
    flipLRChannel () {
      this.applyFlipLRChannel()
    },

    source (url, oldUrl) {
      if (url && url !== oldUrl) {
        this._onSourceChange(url)
      }
    },

    playWorkId (newId, oldId) {
      // 切换作品时重置自动标记提示状态
      if (newId !== oldId) {
        this.workMarkedComplete = false
      }
    },

    muted (flag) {
      if (this.plyr) {
        this.plyr.muted = flag
      }
    },

    volume (val) {
      if (val < 0 || val > 1) {
        return
      }
      if (this.plyr) {
        this.plyr.volume = val
      }
    },
    rewindSeekMode(rewind) {
      if (rewind && this.plyr) {
        // Not plyr.rewind(): it goes through the same setter Plyr's
        // `currentTime` is, which clamps against the element's own duration.
        this.seekMedia(this._playheadSeconds() - (this._osRewindOffset || this.rewindSeekTime))
        this._osRewindOffset = null;
        this.SET_REWIND_SEEK_MODE(false);
      }
    },
    forwardSeekMode(forward) {
      if (forward && this.plyr) {
        this.seekMedia(this._playheadSeconds() + (this._osForwardOffset || this.forwardSeekTime))
        this._osForwardOffset = null;
        this.SET_FORWARD_SEEK_MODE(false);
      }
    },
    currentTime(v) {
      if (this.isChangingCurrentTime) return;
      else this.changeCurrentTime = this.currentTime;
    },
    newCurrentTime(v) {
      if (v < 0) return;
      this.seekMedia(v)
      this.SET_NEW_CURRENT_TIME(-1);
    },
    lyricOffsetSeconds() {
      this.sampleLyrics();
    }
  },

  created() {
    this._pendingStart = null;
    this._lrcLoadId = 0;
    this._lyricStreams = null;
    this._lyricFrame = [];
    // Sorted cue times at which the bar can change, and the single timer
    // waiting for the next one. Both are per-track state, not reactive.
    this._lyricBoundaries = [];
    this._lyricTimer = null;
    // When the OS was last told where the playhead is (ms, 0 = never).
    this._positionStateAt = 0;
    // The position the last seek asked for, until `seeked` reports where it
    // actually landed (null = nothing outstanding).
    this._seekAsked = null;
    // trackId the duration disagreement was already logged for, so a stream of
    // `durationchange` events cannot turn one diagnostic into a flood.
    this._durationConflictReported = null;
  },

  methods: {
    formatSeconds,

    onPause() {
      // The element is already paused here, so this publishes the last line
      // without arming a boundary timer.
      this.sampleLyrics()
      this.PAUSE()
      // Freeze the widget's playhead where the element stopped instead of
      // letting the OS keep extrapolating it.
      this.updatePositionState()
    },
    onPlaying() {
      this.resumeAudioContext()
      this.PLAY()
      this.sampleLyrics()
      this.updatePositionState()
    },

    resumeAudioContext () {
      if (this._lrCtx && this._lrCtx.state === 'suspended') {
        this._lrCtx.resume().catch(() => {})
      }
    },
    onWaiting() {
      this.PLAY()
      // The clock has stopped, so a pending boundary is no longer due when the
      // timer says it is. `playing`/`timeupdate` re-arm this.
      this._clearLyricTimer()
    },

    onRateChange() {
      this.sampleLyrics()
      // The OS extrapolates with the rate it was last given.
      this.updatePositionState()
    },

    onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        this._clearLyricTimer()
        return
      }
      // Timers do not run while the document is hidden, so whatever is on
      // screen is stale by now.
      this.sampleLyrics()
    },
    ...mapMutations('AudioPlayer', [
      'SET_DURATION',
      'SET_CURRENT_TIME',
      'PAUSE',
      'PLAY',
      'SET_TRACK',
      'NEXT_TRACK',
      'PREVIOUS_TRACK',
      'SET_CURRENT_LYRICS',
      'SET_LYRIC_SPEAKERS',
      'SET_VOLUME',
      'CLEAR_SLEEP_MODE',
      'DECREMENT_SLEEP_TRACKS',
      'SET_REWIND_SEEK_MODE',
      'SET_FORWARD_SEEK_MODE',
      'SET_HAS_LYRIC',
      'SET_LYRIC_CUES',
      'ARM_SEEK_UNDO',
      'SET_NEW_CURRENT_TIME',
    ]),

    // Memo (ffprobe) wins: Safari's own Ogg/Opus duration is an estimate it
    // never corrects. Element value is the fallback for tracks without a memo.
    onDurationChange () {
      this.SET_DURATION(this._trackDuration())
      // A late element duration is the only length some tracks ever get.
      this.updatePositionState()
      this._reportDurationConflict()
    },

    // One line per track when the element's length and the memo disagree, because
    // that single pair of numbers is what says which side is wrong: an Ogg/Opus
    // estimate that is far too long (Safari), or a stale memo that does not
    // belong to this file. Neither is visible from anywhere but the device that
    // has the file, and both read as "the duration is wrong again".
    _reportDurationConflict () {
      if (!this.plyr) return
      const element = Number(this.plyr.duration)
      const memo = Number(this.currentPlayingFile && this.currentPlayingFile.duration)
      if (!(element > 0) || !(memo > 0) || Math.abs(element - memo) < 2) return
      const trackId = this.currentPlayingFile.trackId
      if (this._durationConflictReported === trackId) return
      this._durationConflictReported = trackId
      console.warn(
        `duration disagreement on ${trackId}: element ${element}s, memo ${memo}s ` +
        `(${this.source})`
      )
    },

    onCanplay () {
      this.onDurationChange()

      this._applyPendingStart(true)

      if (this.playing && this.plyr.currentTime !== this.plyr.duration) {
        this.plyr.play()
      }
    },

    onTimeupdate () {
      // Until the start position has been applied, the element's clock is the
      // pre-seek one -- publishing it would overwrite where this track should
      // start, and then there would be nothing left to seek to.
      if (this._pendingStart === null && this.plyr.media.readyState >= HTMLMediaElement.HAVE_METADATA) {
        this.SET_CURRENT_TIME(this.plyr.currentTime)
      }
      // Backstop for the boundary timer: a coalesced or swallowed timer costs
      // at most this ~4x/s interval, and one that fired late is corrected from
      // the clock it reads. Publishing is conditional, so when the text has not
      // changed this does no work.
      this.sampleLyrics()

      // Backstop for the widget's timeline as well: a stall, a rate the OS
      // never received, or a clock that drifted are all corrected here.
      if (Date.now() - this._positionStateAt >= POSITION_STATE_REFRESH_MS) {
        this.updatePositionState()
      }

      if (this.sleepMode && this.sleepModeType === 'minutes' && this.sleepStopAt && Date.now() >= this.sleepStopAt) {
        this._stopBySleepTimer()
      }
    },

    // Mark as finished when the last track in queue finishes
    maybeMarkWorkComplete () {
      if (this.playWorkId === 0) return
      if (!this.workLastTrackId) return
      if (!this.currentPlayingFile || this.currentPlayingFile.trackId !== this.workLastTrackId) return
      if (!this.autoMarkListened) return
      if (this.workMarkedComplete) return
      this.workMarkedComplete = true
      this.$axios.put(`/api/review/${this.playWorkId}`, {
        progress: 'listened'
      }, {
        params: { starOnly: false, progressOnly: true, autoMark: true }
      })
        .then(() => {
          this.$q.notify({
            message: this.t('audioelement.autoMarkedListened'),
            timeout: 1500,
            color: 'primary',
            icon: 'task_alt'
          })
        })
        .catch((err) => {
          console.error(err)
        })
    },

    // Fire-and-forget per-track progress report.
    // Reports the current track's position via its trackId.
    _reportTrackProgress () {
      const file = this.currentPlayingFile
      if (!file || !file.trackId || this.playWorkId === 0) return
      const seconds = this.plyr ? this.plyr.currentTime : 0
      // The memo, not the element: Safari's Ogg/Opus estimate is often far
      // larger than the real length, which would keep `completed` false
      // forever and the work from ever being auto-marked.
      const duration = this._trackDuration()
      const completed = duration > 0 && seconds >= 0.95 * duration
      const observedAt = Date.now()

      savePosition({
        trackId: file.trackId,
        workId: this.playWorkId,
        seconds: seconds,
        completed,
        observedAt,
      }).catch((err) => console.error('local position write failed:', err))

      sendOrQueue(this.$axios, {
        method: 'PUT',
        url: `/api/track-progress/${encodeTrackId(file.trackId)}`,
        body: {
          seconds: seconds,
          completed: completed,
          observedAt
        }
      })
    },

    // Playing from the end of a track is the position browsers disagree on:
    // Chrome rewinds to 0 and replays it, Firefox fires `ended`. See §2.7.3.
    _atEndOfTrack () {
      if (!this.plyr) return false
      const duration = this._trackDuration()
      if (!(duration > 0)) return false
      // Until the element has loaded the current track, its clock belongs to
      // the outgoing one (or says 0); the store describes the current track.
      const loaded = this._mediaHoldsCurrentTrack()
        && this.plyr.media.readyState >= HTMLMediaElement.HAVE_METADATA
      const position = loaded ? this.plyr.currentTime : this.currentTime
      return position >= duration - FINISHED_EPSILON_SECONDS
    },

    // Apply the start position this track was loaded with, now that the file is
    // further along. `last` is canplay: hold it no longer, so a file the browser
    // will not seek in ends up owning its own clock again.
    _applyPendingStart (last) {
      const seconds = this._pendingStart
      if (seconds === null) return
      const media = this.plyr.media
      if (Math.abs(media.currentTime - seconds) > 0.5) media.currentTime = seconds
      if (last || Math.abs(media.currentTime - seconds) <= 0.5) {
        this._pendingStart = null
        this.SET_CURRENT_TIME(media.currentTime)
      }
    },

    _mediaHoldsCurrentTrack () {
      const media = this.plyr.media
      if (!media || !media.currentSrc || !this.source) return false
      return media.currentSrc === new URL(this.source, window.location.href).href
    },

    // How long this track really runs. The queue item's ffprobe memo wins;
    // Safari's own Ogg/Opus duration is an estimate read off the bitrate, which
    // it never corrects, and the element value is only the fallback for tracks
    // scanned before durations were recorded.
    _trackDuration () {
      const memo = Number(this.currentPlayingFile && this.currentPlayingFile.duration)
      if (memo > 0) return memo
      const element = this.plyr ? Number(this.plyr.duration) : 0
      return element > 0 ? element : 0
    },

    // Where the playhead is, in the current track's own timeline.
    _playheadSeconds () {
      // Until the element has loaded the current track its clock belongs to
      // the outgoing one (or says 0); the store describes the current track.
      const loaded = this.plyr
        && this._mediaHoldsCurrentTrack()
        && this.plyr.media.readyState >= HTMLMediaElement.HAVE_METADATA
      const seconds = Number(loaded ? this.plyr.currentTime : this.currentTime)
      return Number.isFinite(seconds) ? seconds : 0
    },

    _advanceIfAtEndOfTrack () {
      if (!this._atEndOfTrack()) return false
      // Still describes the finished track.
      this.SET_CURRENT_TIME(0)
      if (this.queueIndex < this.queue.length - 1) {
        this.NEXT_TRACK()
        return true
      }
      // Nothing to advance to on the last track.
      this.seekMedia(0)
      return false
    },

    _stopBySleepTimer () {
      this.PAUSE()
      this.CLEAR_SLEEP_MODE()
      this.$q.notify({
        message: this.t('audioelement.sleepTimerStopped'),
        color: 'primary',
        icon: 'bedtime',
        timeout: 5000
      })
    },

    onEnded () {
      // Firefox fires `ended` for a seek that lands at the end; nothing played.
      if (!this.plyr.media.played.length) return
      this.maybeMarkWorkComplete()
      // Fire-and-forget per-track progress report. Must run before the switch
      // below so currentPlayingFile still refers to the track that just ended.
      this._reportTrackProgress()
      
      if (this.sleepMode && this.sleepModeType === 'tracks') {
        if (this.sleepTracksLeft <= 0) {
          // Stay on the finished track: advancing here would make the
          // queueIndex watcher report progress for a track the user never
          // played. The advance is deferred to their next play.
          this._stopBySleepTimer()
          return
        }
        this.DECREMENT_SLEEP_TRACKS()
      }
      switch (this.playMode.name) {
        case "all repeat":
          if (this.queueIndex === this.queue.length - 1) {
            this.SET_TRACK(0)
          } else {
            this.NEXT_TRACK()
          }
          break
        case "repeat once":
          this.seekMedia(0)
          this.plyr.play()
          this.PLAY()
          break
        case "shuffle": {
          const index = Math.floor(Math.random()*this.queue.length)
          this.SET_TRACK(index)
          if (index === this.queueIndex) {
            this.seekMedia(0)
          }
          break
        }
        default:
          if (this.queueIndex === this.queue.length - 1) {
            this.PAUSE()
          } else {
          this.NEXT_TRACK()
        }
      }
      // Load and play the next track synchronously, inside the event handler.
      // Chrome freezes hidden pages: Vue's nextTick-based `source` watcher
      // may be deferred for minutes, so the watcher-driven load happens far
      // too late. When the watcher eventually fires with the same URL,
      // _loadSource sees the element already has it and skips the reload.
      if (this.playing && this.plyr && this.playMode.name !== "repeat once") {
        const newUrl = this.source
        if (newUrl) {
          this._onSourceChange(newUrl)
        }
      }
    },

    // Imperatively point the media element at `url` and load it.
    // Returns true if a new source was actually loaded; false if the element
    // already has this exact source (and is not in an error state), meaning
    // no reload is needed.
    _loadSource (url) {
      const media = this.plyr && this.plyr.media
      if (!media) return false
      if (!url) {
        media.removeAttribute('src')
        media.load()
        return false
      }
      const absUrl = new URL(url, window.location.href).href
      if (media.currentSrc === absUrl && !media.error) {
        return false
      }
      // The cue table describes the outgoing track and the clock is about to
      // belong to the new one, so the schedule is dropped rather than sampling
      // new positions against old cues. The lines on screen stay until
      // loadLrcFile installs this track's cues (or finds it has none).
      this._clearLyricTimer()
      this._lyricStreams = null
      this._lyricBoundaries = []
      media.src = url
      media.load()
      // Start where the store says this track is. Setting it before metadata
      // arrives is only a request: a container with no duration in its header
      // (Opus in WebM) has nothing to seek against yet, and Safari drops it --
      // so it is kept and applied again once the file is ready. Written to the
      // media element, not Plyr, whose setter ignores seeks while the duration
      // is unknown. See `seekMedia` for what that does to every other seek.
      this._seekAsked = null
      this._pendingStart = this.currentTime > 0 ? this.currentTime : null
      if (this.currentTime > 0) {
        media.currentTime = this.currentTime
      }
      // Retarget now rather than leaving the outgoing track's length on screen.
      this.onDurationChange()
      return true
    },

    // Shared body for reacting to a source change: load the new track,
    // refresh lyrics/metadata, and start playback.
    _onSourceChange (url) {
      if (!this._loadSource(url)) return
      this.loadLrcFile();
      this.updateMediaSessionMetadata();
      if (this.playing) {
        this.plyr.play().catch(() => {})
      }
    },

    onSeeked() {
      this.sampleLyrics();
      // Landed where the widget asked (or where the app seeked): republish so
      // the OS scrubber follows a jump it did not originate.
      this.updatePositionState()
      this._reportSeekClamp()
    },

    // An element whose own duration is wrong is free to clamp the seek we asked
    // for, and Safari does exactly that for Ogg/Opus. Nothing in the app can
    // undo it, so the landed position is the only evidence it happened: report
    // the disagreement once per seek instead of leaving the next "seeking is
    // broken" report unactionable.
    _reportSeekClamp () {
      const asked = this._seekAsked
      if (asked === null) return
      this._seekAsked = null
      const landed = this.plyr.media.currentTime
      if (Math.abs(landed - asked) <= 1) return
      console.warn(
        `seek not honoured: asked ${asked}s, landed ${landed}s ` +
        `(element duration ${this.plyr.duration}s, memo ${this._trackDuration()}s)`
      )
    },

    // Read what every speaker is saying at the playhead and publish it as one
    // frame, so a line arriving for one speaker never drops the line another
    // is still holding on screen. Then re-arm the timer for the next change:
    // every call site -- seek, pause, offset change, `timeupdate` -- therefore
    // leaves the schedule correct without handling it themselves.
    sampleLyrics () {
      const media = this.plyr && this.plyr.media;
      if (!media) return;
      if (this._lyricStreams) {
        const timeMs = (media.currentTime + this.lyricOffsetSeconds) * 1000;
        const frame = this._lyricStreams.map(stream => cueTextAt(stream.cues, timeMs));
        if (frame.some((text, index) => text !== this._lyricFrame[index])) {
          this._lyricFrame = frame;
          this.SET_CURRENT_LYRICS(frame.slice());
        }
      }
      this._scheduleLyricSample(media);
    },

    // Every instant at which the bar can change
    _lyricBoundariesOf (streams) {
      const points = new Set();
      streams.forEach((stream) => {
        stream.cues.forEach((cue) => {
          points.add(cue.start);
          if (Number.isFinite(cue.end)) points.add(cue.end);
        });
      });
      return Array.from(points).sort((a, b) => a - b);
    },

    // First boundary strictly after `timeMs` (cue time, ms), or null when the
    // track has nothing left to show.
    _nextLyricBoundary (timeMs) {
      const points = this._lyricBoundaries;
      let low = 0, high = points.length - 1, found = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (points[mid] > timeMs) {
          found = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      return found === -1 ? null : points[found];
    },

    _clearLyricTimer () {
      if (this._lyricTimer === null) return;
      clearTimeout(this._lyricTimer);
      this._lyricTimer = null;
    },

    _scheduleLyricSample (media) {
      this._clearLyricTimer();
      if (!this._lyricStreams || !this._lyricBoundaries.length) return;
      if (!media || media.paused || media.ended || document.hidden) return;
      const nowMs = (media.currentTime + this.lyricOffsetSeconds) * 1000;
      const nextMs = this._nextLyricBoundary(nowMs);
      if (nextMs === null) return;
      const rate = media.playbackRate > 0 ? media.playbackRate : 1;
      this._lyricTimer = setTimeout(() => {
        this._lyricTimer = null;
        this.sampleLyrics();
      }, Math.max(0, (nextMs - nowMs) / rate));
    },

    setLyricStreams (streams) {
      this._lyricStreams = streams;
      this._lyricBoundaries = this._lyricBoundariesOf(streams);
      this._lyricFrame = streams.map(() => '');
      // Speaker names are fixed for the track, so they go out once here rather
      // than on every frame.
      this.SET_LYRIC_SPEAKERS(streams.map(stream => stream.name));
      this.SET_CURRENT_LYRICS(streams.map(() => ''));
      // The full-screen view needs the whole timeline; the copies keep Vuex from
      // re-observing the parser's arrays, which also carry `endsBy`.
      this.SET_LYRIC_CUES(streams.map(stream => ({
        name: stream.name,
        cues: stream.cues.map(({ start, end, text, voice }) => ({ start, end, text, voice })),
      })));
    },

    async loadLrcFile () {
      const trackId = this.queue[this.queueIndex].trackId;
      const url = `/api/media/check-lrc/${encodeTrackId(trackId)}`;
      const loadId = ++this._lrcLoadId;

      try {
        const check_response = await this.$axios.get(url)
        if (loadId !== this._lrcLoadId) return;
        if (!check_response.data.result) {
          // No lyric for this track: clear the previous track's lines rather
          // than leaving them on screen.
          this.resetToNoLyricStatus();
          return;
        }

        console.log('读入歌词');
        // One entry per speaker file.
        const sources = check_response.data.lyrics || [];
        if (!sources.length) {
          this.resetToNoLyricStatus();
          return;
        }

        const fetched = await Promise.all(sources.map(async (source) => {
          const lrcUrl = this.isFileDownloaded(source.trackId)
            ? `/api/media/offline/${encodeTrackId(source.trackId)}`
            : `/api/media/stream/${encodeTrackId(source.trackId)}`;
          const response = await this.$axios.get(lrcUrl);
          return parseLyricStreams(response.data, (source.lyricExtension || '').toLowerCase());
        }));
        if (loadId !== this._lrcLoadId) return;
        console.log('歌词读入成功');

        const streams = fetched.flat()
          .filter(stream => stream.cues.length > 0)
          .slice(0, MAX_LYRIC_STREAMS);
        if (!streams.length) {
          this.resetToNoLyricStatus();
          return;
        }

        this.setLyricStreams(streams);
        this.sampleLyrics();
        this.SET_HAS_LYRIC(true);
      } catch(error) {
        if (error.response) {
          if (error.response.status !== 401) {
            console.error(error);
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`);
          }
        } else {
          console.error(error)
          this.showErrNotif(error.message || error);
        }
        if (loadId === this._lrcLoadId) this.resetToNoLyricStatus();
      }
    },

    resetToNoLyricStatus() {
      this._clearLyricTimer();
      this._lyricStreams = null;
      this._lyricBoundaries = [];
      this._lyricFrame = [];
      this.SET_LYRIC_SPEAKERS([]);
      this.SET_CURRENT_LYRICS([]);
      this.SET_LYRIC_CUES([]);
      this.SET_HAS_LYRIC(false);
    },

    // setActionHandler throws TypeError for actions the browser doesn't
    // support. Wrap each call so one unsupported action can't prevent the
    // remaining handlers from being registered.
    setMediaSessionHandler(action, handler) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch (e) {
        console.warn(`mediasession: action "${action}" not supported`, e)
      }
    },

    // Publish the playhead to the OS, so the lock screen / Now Playing widget
    // shows this track's real length and where in it we are.
    //
    // Without a position state the widget reads the media element's own clock,
    // and Safari's duration for Ogg/Opus is an estimate it derives from the
    // bitrate: routinely several times the real length, and occasionally
    // shorter than it. That is what made the end time on the widget wrong (and
    // a scrub on the widget land outside the track) even though the in-app bar
    // already read the ffprobe memo. The spec rejects a position outside
    // [0, duration] with a TypeError, so everything is clamped: with a short
    // estimate the element's own clock can sit past the length we publish.
    updatePositionState () {
      const session = navigator.mediaSession
      if (!session || typeof session.setPositionState !== 'function') return

      const duration = this._trackDuration()
      if (!(duration > 0)) {
        this.clearPositionState()
        return
      }
      const position = Math.min(Math.max(this._playheadSeconds(), 0), duration)
      const rate = this.plyr && this.plyr.media.playbackRate > 0
        ? this.plyr.media.playbackRate
        : 1
      try {
        session.setPositionState({ duration, playbackRate: rate, position })
        this._positionStateAt = Date.now()
      } catch (e) {
        // Older WebKit throws for the whole call rather than ignoring it.
        console.warn('mediasession: setPositionState failed', e)
      }
    },

    // `setPositionState()` with no argument clears it (the spec's empty-state
    // case), which is how a stopped session stops advertising a timeline.
    clearPositionState () {
      const session = navigator.mediaSession
      if (!session || typeof session.setPositionState !== 'function') return
      try {
        session.setPositionState()
        this._positionStateAt = 0
      } catch (e) { /* nothing was published */ }
    },

    // Every seek in this component goes through here -- the seek bar, the rail,
    // the lyric rows, the seek buttons, the lock-screen scrubber and the
    // restart after `ended`.
    //
    // Plyr's `currentTime` setter cannot be used for it:
    //
    //     set currentTime (input) {
    //       if (!this.duration) return                          // dropped out
    //       this.media.currentTime = Math.min(input, this.duration)
    //     }
    //
    // and `this.duration` is the *element's*, which for Ogg/Opus on Safari is a
    // bitrate estimate -- short as often as it is long (see `_trackDuration`).
    // Two failures follow, both of which read as "seeking is broken": a seek
    // past that estimate is clamped *to* it, so it lands somewhere else or at
    // the end (which fires `ended` and advances the queue), and a seek before
    // the element has metadata -- Opus in WebM carries no duration in its
    // header -- is dropped outright, so playback simply keeps running from
    // where it was. `_loadSource` and `_applyPendingStart` already avoided
    // Plyr for the same reason; this is that rule applied to every other seek,
    // so exactly one place clamps against the memo. `plyr.rewind()` and
    // `plyr.forward()` are only arithmetic over the same setter, so they go
    // through here too. The element itself may still clamp (see
    // `_reportSeekClamp`), but it is no longer given a wrong bound to clamp to.
    seekMedia (seconds) {
      if (!this.plyr) return
      let target = Number(seconds)
      if (!Number.isFinite(target)) return
      const duration = this._trackDuration()
      target = Math.max(target, 0)
      if (duration > 0) target = Math.min(target, duration)

      const media = this.plyr.media
      // Armed only when this is a real move, so a seek to where the element
      // already is cannot leave the diagnostic pending for someone else's
      // `seeked` to trip over later.
      this._seekAsked = Math.abs(media.currentTime - target) > 0.5 ? target : null
      if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
        // Nothing to seek against yet: `_applyPendingStart` retries it on
        // loadedmetadata and again on canplay. It also replaces any resume
        // point still waiting, which is the position the user actually wants.
        this._pendingStart = target
      } else {
        this._pendingStart = null
        media.currentTime = target
      }
      // Publish now, so the bar and the lock screen do not snap back to the
      // pre-seek playhead while the element catches up (`timeupdate` is 4x/s).
      this.SET_CURRENT_TIME(target)
      this.updatePositionState()
    },

    updateMediaSessionMetadata() {
      console.log("try update media session")
      if (!('mediaSession' in navigator) || !window.MediaMetadata) return

      if (this.playWorkId == 0) {
        navigator.mediaSession.metadata = null;
        MEDIA_SESSION_ACTIONS.forEach(action => this.setMediaSessionHandler(action, null));
        this.clearPositionState()
        return
      }

      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: this.currentPlayingTitle,
          artist: this.playWorkVas.length ? this.playWorkVas[0].name : "",
          album: this.currentPlayingFile.workTitle,
          artwork: [
            {
              src: this.genCoverUrl(this.playWorkId, "main"),
              sizes: "560x560",
              type: "image/jpeg",
            },
            {
              src: this.genCoverUrl(this.playWorkId, "240x240"),
              sizes: "240x240",
              type: "image/jpeg",
            },
            {
              src: this.genCoverUrl(this.playWorkId, "sam"),
              sizes: "100x100",
              type: "image/jpeg",
            },
          ]
        })
      } catch (e) {
        console.warn("set mediasession metadata failed, because: ", e)
      }

      // Drive the element synchronously here, before the mutation: this call
      // is inside the activation context of the lock-screen tap, which is what
      // iOS needs in order to reactivate the audio session. The watcher the
      // mutation wakes up runs a tick later and will no-op.
      this.setMediaSessionHandler('play', () => {
        // Resume here as well as in onPlaying: a media session action counts as
        // an activation gesture, which iOS requires to honour resume().
        this.resumeAudioContext()
        // The `playing` watcher swaps in the next track instead.
        if (this.plyr && this.plyr.paused && !this._atEndOfTrack()) {
          this.plyr.play().catch(() => {})
        }
        this.PLAY()
      })
      this.setMediaSessionHandler('pause', () => {
        if (this.plyr && !this.plyr.paused) this.plyr.pause()
        this.PAUSE()
      })
      this.setMediaSessionHandler('nexttrack', () => {
        this.NEXT_TRACK()
      })
      this.setMediaSessionHandler('previoustrack', () => {
        this.PREVIOUS_TRACK()
      })
      // details.seekOffset is the offset suggested by the OS; prefer it, and
      // fall back to the user's configured rewind/forward seconds when the OS
      // doesn't supply one.
      this.setMediaSessionHandler('seekbackward', (details) => {
        this._osRewindOffset = (details && details.seekOffset) || null
        this.SET_REWIND_SEEK_MODE(true)
      })
      this.setMediaSessionHandler('seekforward', (details) => {
        this._osForwardOffset = (details && details.seekOffset) || null
        this.SET_FORWARD_SEEK_MODE(true)
      })
      // Dragging the widget's scrubber. It is only offered once a position
      // state exists, and it is measured against that same timeline.
      this.setMediaSessionHandler('seekto', (details) => {
        if (!details || typeof details.seekTime !== 'number') return
        // The OS sends the position in *our* published timeline, so it needs no
        // mapping -- only the same clamp every other seek gets.
        this.seekMedia(details.seekTime)
      })

      // Retarget the widget's timeline at this track now, rather than leaving
      // the outgoing track's length on it (the element has not loaded the new
      // one yet, hence the store's currentTime as the starting position).
      this.updatePositionState()
    },

    genCoverUrl(workId, type) {
      if (type == "visualPlayerCover") {
        return this.visualPlayerCoverUrl || ""
      } else if (workId != 0) {
        return apiUrl(`/api/cover/${workId}?type=${type}`)
      } else {
        return ""
      }
    },

    onChangeSlider(v) {
      // `currentTime` still holds the position the drag started from: the
      // watcher that syncs it is held off while `isChangingCurrentTime` is set.
      if (Math.abs(v - this.currentTime) >= 1) {
        this.ARM_SEEK_UNDO({ time: this.currentTime, at: Date.now() })
      }
      this.seekMedia(v);
    },
    onPanSlider(phase) {
      console.warn(" pan with phase = ", phase)
      if (phase == 'start') {
        this.isChangingCurrentTime = true;
        this.changeCurrentTime = this.currentTime;
      } else {
        setTimeout(() => {
          this.isChangingCurrentTime = false;
        }, 100);
      }
    },

    initPlyr () {
      const container = this.$refs.plyrContainer;
      const media = container.querySelector('video') || container.querySelector('audio');
      if (!media) return;

      this.plyr = new Plyr(media, {
        controls: ['progress']
      });

      const player = this.plyr;

      this.SET_VOLUME(player.volume);
      
      // Safari can take the seek here for a file it refused before metadata.
      player.on('loadedmetadata', () => this._applyPendingStart());
      player.on('canplay', () => this.onCanplay());
      player.on('timeupdate', () => this.onTimeupdate());
      player.on('seeked', () => this.onSeeked());
      player.on('playing', () => this.onPlaying());
      player.on('waiting', () => this.onWaiting());
      player.on('pause', () => this.onPause());

      // Single source of truth for 'ended': a direct listener on the media
      // element. Plyr's container-level 'ended' event is proxied from this
      // same native event, so it can never fire when this listener doesn't
      // — and registering both makes onEnded run twice per track end.
      media.addEventListener('ended', this.onEnded);

      // Native listener: 'durationchange' is absent from Plyr's bubble list
      // (config/defaults.js `events`), so player.on() would never fire.
      media.addEventListener('durationchange', this.onDurationChange);

      media.addEventListener('ratechange', this.onRateChange);
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    },

    applyFlipLRChannel () {
      const media = this.plyr && this.plyr.media
      if (!media) return

      if (!this._lrCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext
        if (!AudioCtx) return
        const ctx = new AudioCtx()
        const src = ctx.createMediaElementSource(media)
        const splitter = ctx.createChannelSplitter(2)
        const merger = ctx.createChannelMerger(2)
        src.connect(splitter)
        merger.connect(ctx.destination)
        if (ctx.state === 'suspended') ctx.resume()
        this._lrCtx = ctx
        this._lrSrc = src
        this._lrSplitter = splitter
        this._lrMerger = merger
      }

      try { this._lrSplitter.disconnect() } catch (e) { /* already disconnected */ }
      if (this.flipLRChannel) {
        this._lrSplitter.connect(this._lrMerger, 0, 1) // L -> right out
        this._lrSplitter.connect(this._lrMerger, 1, 0) // R -> left out
      } else {
        this._lrSplitter.connect(this._lrMerger, 0, 0) // L -> left out
        this._lrSplitter.connect(this._lrMerger, 1, 1) // R -> right out
      }
    },
  },

  mounted () {
    this.initPlyr();
    if (this.flipLRChannel) this.applyFlipLRChannel();
    if (this.source) {
      this._loadSource(this.source);
      this.loadLrcFile();
    }
  },

  beforeUnmount() {
    this._clearLyricTimer();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    const container = this.$refs.plyrContainer;
    if (container) {
      const media = container.querySelector('video') || container.querySelector('audio');
      if (media) {
        media.removeEventListener('ended', this.onEnded);
        media.removeEventListener('durationchange', this.onDurationChange);
        media.removeEventListener('ratechange', this.onRateChange);
      }
    }
    if (this._lrCtx) {
      try { this._lrCtx.close() } catch (e) { /* already closed */ }
      this._lrCtx = this._lrSrc = this._lrSplitter = this._lrMerger = null
    }
   },
}
</script>

<style scoped>
/* Quasar's slider root is `display: inline-block`, so a block wrapper keeps a
   line box under it and the marker's 50% lands below the track. Flex makes the
   wrapper exactly as tall as the slider. */
.seek-undo-track {
  display: flex;
}

/* Ghost handle on the seek slider: hollow, so it never reads as the live thumb.
   Quasar puts the thumb's centre at `left: ratio%`, so the same rule aligns. */
.seek-undo-mark {
  position: absolute;
  top: 50%;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 2px solid rgb(var(--primary-rgb));
  border-radius: 50%;
  background: rgb(var(--surface-rgb));
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Quasar animates the thumb and the fill with `left`/`width` transitions while
   the slider is not being dragged (QSlider.sass, `&--inactive`). The playhead is
   published 4x/s, so a .28s transition is restarted every .25s and never
   finishes: the page re-lays-out and composites a frame for every vsync of the
   whole playback session, and the seek bar is the last thing it should be doing
   that for. Without the transitions the fill steps 4x/s (under a pixel per step
   at any real track length) and a seek still lands instantly. */
.q-slider--inactive :deep(.q-slider__thumb),
.q-slider--inactive :deep(.q-slider__selection),
.q-slider--inactive :deep(.q-slider__text-container) {
  transition: none;
}
</style>