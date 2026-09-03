<template>

  <!--在进度条周围监听mouseup、mousedown事件，辅助进度条状态切换-->
  <div class="q-px-md"
      @mousedown.capture="onPanSlider('start')"
      @mouseup.capture="onPanSlider('end')"
  >
    <q-slider v-model="changeCurrentTime"
      @change="onChangeSlider"
      @pan="onPanSlider"
      :min="0" :max="duration" :step="0.01"
      label
      :label-value="formatSeconds(displayCurrentTime)"
      />

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
import Lyric from 'lrc-file-parser'
import { mapState, mapGetters, mapMutations } from 'vuex'
import NotifyMixin from '../mixins/Notification.js'
import { formatSeconds } from '../utils'
import { MAX_LYRIC_STREAMS } from 'src/utils/lyrics'
import { convert_srt_vtt_to_lrc_streams, mergeLyricStreams } from 'src/utils/subtitles'
import { debounce } from 'quasar';
import Plyr from 'plyr'
import { apiUrl } from 'src/base-path'

// Every media session action this component registers; teardown walks this
// list to unregister them one by one.
const MEDIA_SESSION_ACTIONS = [
  'play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward'
]

// A seek landing within this many seconds of the end is treated as a seek to
// the end of the track rather than as the user scrubbing back into it.
const SEEK_END_TOLERANCE_SECONDS = 1

export default {
  name: 'AudioElement',

  mixins: [NotifyMixin],

  data() {
    return {
      lrcContent: "",
      // A single parser for all streams at once — see mergeLyricStreams.
      lrcObj: null,
      plyr: null,

      isChangingCurrentTime: false,
      changeCurrentTime: 0,

      // 防止重复自动标记（同一次播放会话只提示一次）
      workMarkedComplete: false,
    }
  },

  computed: {
    lrcAvailable () {
      return this.lrcObj !== null
    },

    source () {
      if (this.currentPlayingFile.mediaStreamUrl) {
        return `${this.currentPlayingFile.mediaStreamUrl}`
      } else if (this.currentPlayingFile.trackId || this.currentPlayingFile.hash) {
        return apiUrl(`/api/media/stream/${this.currentPlayingFile.trackId || this.currentPlayingFile.hash}`)
      } else {
        return ""
      }
    },

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
      'sleepStoppedTrackId',
      'rewindSeekTime',
      'forwardSeekTime',
      'rewindSeekMode',
      'forwardSeekMode',
      'resumeHistorySeconds',
      'playWorkId',
      'playWorkVas',
      'visualPlayerCoverUrl',
      'duration',
      'currentTime',
      'newCurrentTime',
      'lyricOffsetSeconds',
      'enablePIPLyrics',
      'workLastTrackId',
      'autoMarkListened',
      'flipLRChannel',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'resumeHistoryDone',
    ]),

    // Identity of the track the queue is parked on, in the same
    // trackId-or-hash form the queue items and the sleep marker use.
    currentTrackId() {
      const file = this.currentPlayingFile
      return file.trackId || file.hash || ''
    },

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
        if (this._advanceIfSleepStopped()) return
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
        this.plyr.rewind(this._osRewindOffset || this.rewindSeekTime);
        this._osRewindOffset = null;
        this.SET_REWIND_SEEK_MODE(false);
      }
    },
    forwardSeekMode(forward) {
      if (forward && this.plyr) {
        this.plyr.forward(this._osForwardOffset || this.forwardSeekTime);
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
      if (this.plyr) {
        this.plyr.currentTime = v;
      }
      this.SET_NEW_CURRENT_TIME(-1);
    },
    lyricOffsetSeconds() {
      this.playLrc(this.playing);
    },
    enablePIPLyrics(enablePIP) {
      if (enablePIP) {
        this.playLrc(false)
      } else {
        this.playLrc(this.playing)
      }
    }
  },

  created() {
    this.debouncedPlayLrc = debounce(this.playLrc, 100, true);
    // Bumped on every loadLrcFile() call so a slower load for a track the user
    // has already skipped past cannot apply its lyrics over the current one.
    // Multi-speaker tracks fetch one file per speaker, which widens the window.
    this._lrcLoadId = 0;
    // Non-reactive: rebuilt wholesale per track and only ever read by index.
    this._lyricFrames = [];
  },

  methods: {
    formatSeconds,

    onPause() {
      this.playLrc(false)
      // No _reportTrackProgress() here: PAUSE() flips AudioPlayer's `playing`
      // state, whose watcher runs onUpdatePlayingStatus, which already reports
      // this track's progress. Calling it here too produced two PUTs per pause
      // with the same contentHash ~500ms apart (the watcher path is debounced).
      // onEnded still reports directly -- there it is not redundant, since it
      // must run before the queue advances to capture the finishing track.
      this.PAUSE()
    },
    onPlaying() {
      this.resumeAudioContext()
      this.playLrc(true)
      this.PLAY()
    },

    // Once the flip-LR graph exists, createMediaElementSource has permanently
    // rerouted the element's output through the context, so a suspended
    // context means silent playback. The resume() at graph construction is not
    // enough on its own: applyFlipLRChannel runs from mounted() when the
    // setting is persisted on, which is before any user activation, and
    // autoplay policy rejects a resume() there. Retrying on each play covers
    // that, and any later suspension (iOS suspends the context when the audio
    // session is interrupted, and never resumes it by itself).
    resumeAudioContext () {
      if (this._lrCtx && this._lrCtx.state === 'suspended') {
        this._lrCtx.resume().catch(() => {})
      }
    },
    onWaiting() {
      this.playLrc(false)
      this.PLAY()
    },
    ...mapMutations('AudioPlayer', [
      'SET_DURATION',
      'SET_CURRENT_TIME',
      'PAUSE',
      'PLAY',
      'SET_TRACK',
      'NEXT_TRACK',
      'SET_SLEEP_STOPPED_TRACK',
      'CLEAR_SLEEP_STOPPED_TRACK',
      'PREVIOUS_TRACK',
      'SET_CURRENT_LYRICS',
      'SET_LYRIC_SPEAKERS',
      'SET_VOLUME',
      'CLEAR_SLEEP_MODE',
      'DECREMENT_SLEEP_TRACKS',
      'SET_REWIND_SEEK_MODE',
      'SET_FORWARD_SEEK_MODE',
      'RESUME_HISTORY_SECONDS_DONE',
      'SET_HAS_LYRIC',
      'SET_NEW_CURRENT_TIME',
    ]),

    // Memo (ffprobe) wins: Safari's own Ogg/Opus duration is an estimate it
    // never corrects. Element value is the fallback for tracks without a memo.
    onDurationChange () {
      const memo = this.currentPlayingFile.duration
      this.SET_DURATION(memo > 0 ? memo : (this.plyr ? this.plyr.duration : 0))
    },

    onCanplay () {
      this.onDurationChange()

      if (this.playing && this.plyr.currentTime !== this.plyr.duration) {
        this.plyr.play()
      }

      if (!this.resumeHistoryDone) {
        this.plyr.currentTime = this.resumeHistorySeconds;
        this.RESUME_HISTORY_SECONDS_DONE()
        this.$q.notify({message: this.$t('audioelement.resumeHistory'), timeout: 1000})
      }
    },

    onTimeupdate () {
      this.SET_CURRENT_TIME(this.plyr.currentTime)
      if (this.enablePIPLyrics) this.debouncedPlayLrc(false)
      // 睡眠定时（按分钟）：到达停止时间戳即暂停
      if (this.sleepMode && this.sleepModeType === 'minutes' && this.sleepStopAt && Date.now() >= this.sleepStopAt) {
        this._stopBySleepTimer()
      }
    },

    // 当前播放文件夹的最后一首音频自然播放结束时，自动将进度标记为“听完”
    // Phase 1：仅比较当前文件trackId与workLastTrackId（会话内快照，trackId稳定）
    // Phase 2：将替换这里的条件为“主系列全部曲目已完成”
    maybeMarkWorkComplete () {
      if (this.playWorkId === 0) return
      if (!this.workLastTrackId) return
      if (!this.currentPlayingFile || (this.currentPlayingFile.trackId || this.currentPlayingFile.hash) !== this.workLastTrackId) return
      if (!this.autoMarkListened) return
      if (this.workMarkedComplete) return
      this.workMarkedComplete = true
      this.$axios.put('/api/review', {
        work_id: this.playWorkId,
        progress: 'listened'
      }, {
        params: { starOnly: false, progressOnly: true, autoMark: true }
      })
        .then(() => {
          this.$q.notify({
            message: this.$t('audioelement.autoMarkedListened'),
            timeout: 1500,
            color: 'primary',
            icon: 'task_alt'
          })
        })
        .catch((err) => {
          console.error(err)
        })
    },

    // Fire-and-forget per-track progress report (Phase 2).
    // Reports the current track's position via contentHash.
    _reportTrackProgress () {
      const file = this.currentPlayingFile
      if (!file || !file.contentHash || this.playWorkId === 0) return
      const seconds = this.plyr ? this.plyr.currentTime : 0
      const duration = this.plyr ? this.plyr.duration : 0
      const completed = duration > 0 && seconds >= 0.95 * duration
      this.$axios.put('/api/track-progress', {
        work_id: this.playWorkId,
        contentHash: file.contentHash,
        seconds: Math.round(seconds * 100) / 100,
        completed: completed
      }).catch((err) => {
        console.error('track progress report failed:', err)
      })
    },

    // The tracks-mode sleep timer leaves the queue on the track that just
    // finished, so nothing writes progress for a track the user never played.
    // Their next play consumes that here and moves on instead of replaying it.
    _advanceIfSleepStopped () {
      const stoppedTrackId = this.sleepStoppedTrackId
      if (!stoppedTrackId) return false
      this.CLEAR_SLEEP_STOPPED_TRACK()
      // Track check: if the user picked a different track meanwhile, that
      // choice wins. Watcher order makes clearing the marker on track change
      // unreliable, comparing the track does not. It is compared by trackId
      // rather than by queue index because the queue is rebuilt from scratch
      // when the player is resumed from history.
      if (stoppedTrackId !== this.currentTrackId) return false
      if (this.queueIndex >= this.queue.length - 1) return false
      // Any pending history resume belongs to the finished track, not to the
      // one about to load -- onCanplay would otherwise drop the next track in
      // at the previous track's position.
      this.RESUME_HISTORY_SECONDS_DONE()
      // The stored position is still the finished track's, and AudioPlayer's
      // queueIndex watcher reports progress from it against whatever track the
      // queue now points at. The next track really is at 0 until it loads.
      this.SET_CURRENT_TIME(0)
      this.NEXT_TRACK()
      return true
    },

    _stopBySleepTimer () {
      this.PAUSE()
      this.CLEAR_SLEEP_MODE()
      this.$q.notify({
        message: this.$t('audioelement.sleepTimerStopped'),
        color: 'primary',
        icon: 'bedtime',
        timeout: 5000
      })
    },

    onEnded () {
      this.maybeMarkWorkComplete()
      // Fire-and-forget per-track progress report (Phase 2).
      // Must run before the switch below so currentPlayingFile still
      // refers to the track that just ended.
      this._reportTrackProgress()
      // 睡眠定时（按曲目）：剩余曲目数为 0 时在当前曲目结束后停止，否则扣减一首
      // 必须在切换曲目逻辑之前处理：一旦推进到下一曲，"当前曲目结束后停止" 就无法实现了
      if (this.sleepMode && this.sleepModeType === 'tracks') {
        if (this.sleepTracksLeft <= 0) {
          // Stay on the finished track: advancing here would make the
          // queueIndex watcher report progress for a track the user never
          // played. The advance is deferred to their next play.
          this.SET_SLEEP_STOPPED_TRACK(this.currentTrackId)
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
          this.plyr.currentTime = 0
          this.plyr.play()
          this.PLAY()
          break
        case "shuffle": {
          const index = Math.floor(Math.random()*this.queue.length)
          this.SET_TRACK(index)
          if (index === this.queueIndex) {
            this.plyr.currentTime = 0
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
      media.src = url
      media.load()
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
      // Scrubbing back into the finished track means the user wants that
      // track, not the next one -- but only a seek that actually lands inside
      // the track counts. A seek to its end is not the user at all: onCanplay
      // seeks there itself when a history resume is pending, and Chrome
      // replays that seek whenever it reloads the media resource it reclaimed
      // from a paused background page.
      const duration = this.duration
      const landedInsideTrack = !(duration > 0) ||
        this.plyr.currentTime < duration - SEEK_END_TOLERANCE_SECONDS
      if (landedInsideTrack) this.CLEAR_SLEEP_STOPPED_TRACK()
      this.playLrc(this.playing);
    },

    playLrc (playStatus) {
      if (!this.lrcAvailable) return;
      // All speakers ride one parser, so they cannot drift apart under seeking
      // or the offset slider.
      this.lrcObj.play((this.plyr.currentTime + this.lyricOffsetSeconds) * 1000);
      if (!playStatus) this.lrcObj.pause();
    },

    // Interleave the speakers into one parser and publish a whole frame — every
    // speaker's current line — on each tick, so a line arriving for one speaker
    // never drops the line another is still holding on screen. Speaker names
    // are fixed for the track, so they go out once here, not on every line.
    setLyricStreams (streams) {
      this.stopLrcObj();
      const { lyric, frames } = mergeLyricStreams(streams, Lyric);
      this._lyricFrames = frames;
      this.lrcObj = new Lyric({
        onPlay: (line, text) => {
          const frame = this._lyricFrames[parseInt(text, 10)];
          if (frame) this.SET_CURRENT_LYRICS(frame.slice());
        },
      });
      this.lrcObj.setLyric(lyric);
      this.lrcContent = streams.map(stream => stream.content).join('\n');
      this.SET_LYRIC_SPEAKERS(streams.map(stream => stream.name));
      this.SET_CURRENT_LYRICS(streams.map(() => ''));
    },

    stopLrcObj () {
      if (!this.lrcObj) return;
      this.lrcObj.pause();
      this.lrcObj.setLyric('');
    },

    async loadLrcFile () {
      const trackId = (this.queue[this.queueIndex].trackId || this.queue[this.queueIndex].hash);
      const url = `/api/media/check-lrc/${trackId}`;
      const loadId = ++this._lrcLoadId;

      try {
        const check_response = await this.$axios.get(url)
        if (loadId !== this._lrcLoadId) return;
        if (!check_response.data.result) {
          //new track has no lyric — clear the previous track's lyric
          // state so its onPlay callback stops firing SET_CURRENT_LYRICS.
          this.resetToNoLyricStatus();
          return;
        }

        console.log('读入歌词');
        // `lyrics` holds one entry per speaker file; the singular fields are
        // the pre-multi-speaker shape, still sent by the backend so that a
        // cached older bundle keeps working — read them the same way here.
        const sources = check_response.data.lyrics && check_response.data.lyrics.length
          ? check_response.data.lyrics
          : [{
              trackId: check_response.data.trackId || check_response.data.hash,
              lyricExtension: check_response.data.lyricExtension,
            }];

        const fetched = await Promise.all(sources.map(async (source) => {
          const response = await this.$axios.get(`/api/media/stream/${source.trackId}`);
          const lyricExtension = (source.lyricExtension || '').toLowerCase();
          if (lyricExtension === '.srt' || lyricExtension === '.vtt') {
            console.log('srt convert to lrc');
            // A single .vtt carrying voice spans expands to several named
            // streams; SRT has no voice span, so it yields one unnamed stream.
            return convert_srt_vtt_to_lrc_streams(response.data);
          }
          // LRC has no speaker field at all, so it is always one unnamed stream.
          return [{ name: null, content: String(response.data) }];
        }));
        if (loadId !== this._lrcLoadId) return;
        console.log('歌词读入成功');

        const streams = fetched.flat()
          .filter(stream => stream.content.trim() !== '')
          .slice(0, MAX_LYRIC_STREAMS);
        if (!streams.length) {
          this.resetToNoLyricStatus();
          return;
        }

        this.setLyricStreams(streams);
        this.playLrc(this.playing);
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
      this.stopLrcObj();
      this.lrcObj = null;
      this._lyricFrames = [];
      this.lrcContent = '';
      this.SET_LYRIC_SPEAKERS([]);
      this.SET_CURRENT_LYRICS([]);
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

    updateMediaSessionMetadata() {
      console.log("try update media session")
      if (!('mediaSession' in navigator) || !window.MediaMetadata) return

      if (this.playWorkId == 0) {
        navigator.mediaSession.metadata = null;
        MEDIA_SESSION_ACTIONS.forEach(action => this.setMediaSessionHandler(action, null));
        return
      }

      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: this.currentPlayingFile.title,
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
        // Don't restart the finished track when a sleep-timer advance is
        // pending -- the `playing` watcher swaps in the next one.
        if (!this.sleepStoppedTrackId && this.plyr && this.plyr.paused) {
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
      console.log("player current time is ", this.plyr.currentTime)
      console.log("slider change value to ", v)
      console.log("global current time is ", this.currentTime)
      this.plyr.currentTime = v;
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
    },

    initAudioAnalyzer () {
      // retained as a no-op hook; flip is applied lazily via applyFlipLRChannel
    },

    // createMediaElementSource 是单向门：一旦调用，媒体输出即被该 AudioContext
    // 接管，无法回到原生路径。因此首启后整条路由保留，切换只改 splitter->merger
    // 的接法（交叉 vs 正常），close 仅在组件卸载时执行。
    applyFlipLRChannel () {
      const media = this.plyr && this.plyr.media
      if (!media) return

      // 首次开启：构建路由并缓存节点
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

      // 重接 splitter -> merger：开启时交叉，关闭时正常
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
    this.initAudioAnalyzer();
    if (this.flipLRChannel) this.applyFlipLRChannel();
    if (this.source) {
      this._loadSource(this.source);
      this.loadLrcFile();
    }
  },

  beforeUnmount() {
    const container = this.$refs.plyrContainer;
    if (container) {
      const media = container.querySelector('video') || container.querySelector('audio');
      if (media) {
        media.removeEventListener('ended', this.onEnded);
        media.removeEventListener('durationchange', this.onDurationChange);
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
</style>