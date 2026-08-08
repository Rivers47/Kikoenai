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
import { debounce } from 'quasar';
import Plyr from 'plyr'

function convert_srt_vtt_to_lrc(text) {
  let lines = text.split("\n").map(l => l.trim())
  let isVtt = lines[0] == 'WEBVTT';
  if (isVtt) {
    lines = lines.slice(1)
  }

  const timeParseRe = /(\d*):(\d*):(\d*)(\.|,)(\d*)\s*-->\s*[\d:.]*/

  const parsingUnit = [];
  let i = 0;
  while(i < lines.length) {

    if (/^\d*$/.test(lines[i++])) {
      if (timeParseRe.test(lines[i])) {
        const [_whole, h, m, s, _mill_sep, ms] = timeParseRe.exec(lines[i]).map(x => parseInt(x));
        let texts = [];
        i++;
        while(i < lines.length && lines[i] != "") {
          texts.push(lines[i++]);
        }
        parsingUnit.push([
          [h, m, s, ms],
          texts.join(' '),
        ]);
      }
    }
  }

  function padding(n, len) {
    n = Math.ceil(n);
    let s = `${n}`;
    let pad = len - s.length;
    if (pad > 0) {
      for (let i = 0; i < pad; ++i) {
        s = "0" + s;
      }
    }
    return s;
  }

  function formatLrcTime([h, m, s, ms]) {
    return padding(h * m, 2) + ":" + padding(m, 2) + ":" + padding(s, 2) + "." + padding(ms, 3);
  }

  const lrcContent = parsingUnit.map(([time, text]) => `[${formatLrcTime(time)}] ${text}`).join("\n");
  return lrcContent;
}

export default {
  name: 'AudioElement',

  mixins: [NotifyMixin],

  data() {
    return {
      lrcContent: "",
      lrcObj: null,
      lrcAvailable: false,
      plyr: null,

      isChangingCurrentTime: false,
      changeCurrentTime: 0,

      // 防止重复自动标记（同一次播放会话只提示一次）
      workMarkedComplete: false,
    }
  },

  computed: {
    source () {
      if (this.currentPlayingFile.mediaStreamUrl) {
        return `${this.currentPlayingFile.mediaStreamUrl}`
      } else if (this.currentPlayingFile.trackId || this.currentPlayingFile.hash) {
        return `/api/media/stream/${this.currentPlayingFile.trackId || this.currentPlayingFile.hash}`
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
      'rewindSeekTime',
      'forwardSeekTime',
      'rewindSeekMode',
      'forwardSeekMode',
      'resumeHistorySeconds',
      'playWorkId',
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

    displayCurrentTime() {
      if (this.isChangingCurrentTime) return this.changeCurrentTime;
      else return this.currentTime;
    }
  },

  watch: {
    playing (flag) {
      if (this.plyr && this.plyr.duration) {
        flag ? this.plyr.play() : this.plyr.pause()
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
        this.plyr.rewind(this.rewindSeekTime);
        this.SET_REWIND_SEEK_MODE(false);
      }
    },
    forwardSeekMode(forward) {
      if (forward && this.plyr) {
        this.plyr.forward(this.forwardSeekTime);
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
  },

  methods: {
    formatSeconds,

    onPause() {
      this.playLrc(false)
      this.PAUSE()
      // Fire-and-forget per-track progress on pause (Phase 2)
      this._reportTrackProgress()
    },
    onPlaying() {
      this.playLrc(true)
      this.PLAY()
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
      'PREVIOUS_TRACK',
      'SET_CURRENT_LYRIC',
      'SET_VOLUME',
      'CLEAR_SLEEP_MODE',
      'DECREMENT_SLEEP_TRACKS',
      'SET_REWIND_SEEK_MODE',
      'SET_FORWARD_SEEK_MODE',
      'RESUME_HISTORY_SECONDS_DONE',
      'SET_HAS_LYRIC',
      'SET_NEW_CURRENT_TIME',
    ]),

    onCanplay () {
      this.SET_DURATION(this.plyr.duration)

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
      this.playLrc(this.playing);
    },

    playLrc (playStatus) {
      if (this.lrcAvailable) {
        if (playStatus) {
          this.lrcObj.play((this.plyr.currentTime + this.lyricOffsetSeconds) * 1000);
        } else {
          this.lrcObj.play((this.plyr.currentTime + this.lyricOffsetSeconds) * 1000);
          this.lrcObj.pause();
        }
      }
    },

    createLrcObj () {
        this.lrcObj = new Lyric({
          onPlay: (line, text) => {
            this.SET_CURRENT_LYRIC(text);
          },
        })
    },

    async loadLrcFile () {
      const trackId = (this.queue[this.queueIndex].trackId || this.queue[this.queueIndex].hash);
      const url = `/api/media/check-lrc/${trackId}`;

      try {
        const check_response = await this.$axios.get(url)
        if (!check_response.data.result) {
          //new track has no lyric — clear the previous track's lyric
          // state so its onPlay callback stops firing SET_CURRENT_LYRIC.
          this.resetToNoLyricStatus();
          return;
        }

        this.lrcAvailable = true;
        console.log('读入歌词');
        const lrcUrl = `/api/media/stream/${check_response.data.trackId || check_response.data.hash}`;
        const lyricExtension = check_response.data.lyricExtension.toLowerCase();

        const response = await this.$axios.get(lrcUrl)
        console.log('歌词读入成功');
        console.log('srt convert to lrc');
        if (lyricExtension == ".srt" || lyricExtension == ".vtt") {
          response.data = convert_srt_vtt_to_lrc(response.data);
        }
        this.lrcObj.setLyric(response.data);
        this.lrcContent = response.data;
        this.lrcObj.play(this.plyr.currentTime * 1000);
        if (!this.playing) this.lrcObj.pause()
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
        this.SET_HAS_LYRIC(false);
      }
    },

    resetToNoLyricStatus() {
      this.lrcAvailable = false;
      this.lrcObj.setLyric('');
      this.lrcContent = '';
      this.SET_CURRENT_LYRIC('');
      this.SET_HAS_LYRIC(false);
    },

    updateMediaSessionMetadata() {
      console.log("try update media session")
      try {
        if (this.playWorkId == 0) {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('nexttrack', null);
          navigator.mediaSession.setActionHandler('previoustrack', null);
          navigator.mediaSession.setActionHandler('seekbackward', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
        } else {
          navigator.mediaSession.metadata = new window.MediaMetadata({
            title: this.currentPlayingFile.title,
            artist: "",
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

          navigator.mediaSession.setActionHandler('play', () => {
            this.PLAY()
            if (this.plyr) this.plyr.play()
          })
          navigator.mediaSession.setActionHandler('pause', () => {
            this.PAUSE()
            if (this.plyr) this.plyr.pause()
          })
          navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.NEXT_TRACK()
          })
          navigator.mediaSession.setActionHandler('previoustrack', () => {
            this.PREVIOUS_TRACK()
          })
          navigator.mediaSession.setActionHandler('seekbackward', () => {
            this.SET_REWIND_SEEK_MODE(true)
          })
          navigator.mediaSession.setActionHandler('seekforward', () => {
            this.SET_FORWARD_SEEK_MODE(true)
          })
        }
      } catch (e) {
        console.warn("set mediasession failed, because: ", e)
      }
    },

    genCoverUrl(workId, type) {
      if (type == "visualPlayerCover") {
        return this.visualPlayerCoverUrl || ""
      } else if (workId != 0) {
        return `/api/cover/${workId}?type=${type}`
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
    this.createLrcObj();
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