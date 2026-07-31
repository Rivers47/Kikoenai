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
    <!--使用video组件来播放音频和视频文件，同时隐藏原生的vue-plyr组件，这里的组件只会留下一个进度条的功能
    之所以用video，是因为video可以设置mp3等音频文件，也可以播放mp4等视频文件，在播放视频的时候，还能够用该video元素作为canvas绘制来源，
    反之，audio虽然可以播放video的音频，但是将其作为canvas的绘制源，因此倾向于使用video来播放所有媒体元素-->
    <!--注意，这里video设置了一个id，因为需要被其他组件通过document.querySelector方式进行查找引用-->
    <div ref="plyrContainer" style="display: none;">
      <!-- media src is managed imperatively (see _loadSource): a <source :src>
           binding only takes effect via media.load() and races with the
           nextTick-deferred watcher when Chrome freezes the hidden page -->
      <video v-if="enableVideoSource" class="hide-in-global-page-for-pip" id="mediaVideo" crossorigin="anonymous" playsinline controls>
      </video>
      <audio v-else crossorigin="anonymous">
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
    }
  },

  computed: {
    source () {
      const token = this.$q.localStorage.getItem('jwt-token') || ''
      if (this.currentPlayingFile.mediaStreamUrl) {
        return `${this.currentPlayingFile.mediaStreamUrl}?token=${token}`
      } else if (this.currentPlayingFile.hash) {
        return `/api/media/stream/${this.currentPlayingFile.hash}?token=${token}`
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
      'enableVisualizer',
      'resumeHistroySeconds',
      'playWorkId',
      'visualPlayerCoverUrl',
      'duration',
      'currentTime',
      'newCurrentTime',
      'enableVideoSource',
      'lyricOffsetSeconds',
      'enablePIPLyrics',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'resumeHistroyDone',
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

    source (url, oldUrl) {
      if (url && url !== oldUrl) {
        this._onSourceChange(url)
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
      'SET_AUDIO_ANALYSER',
      'RESUME_HISTROY_SECONDS_DONE',
      'SET_HAS_LYRIC',
      'SET_NEW_CURRENT_TIME',
    ]),

    onCanplay () {
      this.SET_DURATION(this.plyr.duration)

      if (this.playing && this.plyr.currentTime !== this.plyr.duration) {
        this.plyr.play()
      }

      if (!this.resumeHistroyDone) {
        this.plyr.currentTime = this.resumeHistroySeconds;
        this.RESUME_HISTROY_SECONDS_DONE()
        this.$q.notify({message: "已恢复播放历史", timeout: 1000})
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

    _stopBySleepTimer () {
      this.PAUSE()
      this.CLEAR_SLEEP_MODE()
      this.$q.notify({
        message: '睡眠定时已到，停止播放',
        color: 'primary',
        icon: 'bedtime',
        timeout: 5000
      })
    },

    onEnded () {
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
      const token = this.$q.localStorage.getItem('jwt-token') || '';
      const fileHash = this.queue[this.queueIndex].hash;
      const url = `/api/media/check-lrc/${fileHash}?token=${token}`;

      try {
        const check_response = await this.$axios.get(url)
        if (!check_response.data.result) {
          return;
        }

        this.lrcAvailable = true;
        console.log('读入歌词');
        const lrcUrl = `/api/media/stream/${check_response.data.hash}?token=${token}`;
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
      const token = this.$q.localStorage.getItem('jwt-token') || ''

      if (type == "visualPlayerCover") {
        return this.visualPlayerCoverUrl
          ? `${this.visualPlayerCoverUrl}?token=${token}`
          : ""
      } else if (workId != 0) {
        return `/api/cover/${workId}?type=${type}&token=${token}`
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
      const initAudio = () => {
        document.removeEventListener('click', initAudio);
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = {
          left: audioCtx.createAnalyser(),
          right: audioCtx.createAnalyser(),
          audioCtx,
          splitter: null,
          merger: null,
          audioSrc: null,
        };

        const container = this.$refs.plyrContainer;
        const media = container.querySelector('video') || container.querySelector('audio');
        if (!media) return;

        analyser.audioSrc = audioCtx.createMediaElementSource(media);
        analyser.splitter = audioCtx.createChannelSplitter(2);
        analyser.merger = audioCtx.createChannelMerger(2);
        analyser.audioSrc.connect(analyser.splitter);
        analyser.splitter.connect(analyser.left, 0);
        analyser.splitter.connect(analyser.right, 1);
        analyser.audioSrc.connect(audioCtx.destination)
        this.SET_AUDIO_ANALYSER(analyser)
      }

      if (this.enableVisualizer) {
        document.addEventListener('click', initAudio);
        if (this.$q.platform.is.safari && this.$q.platform.is.mobile) {
          this.$q.notify({
            message: "监测到safari平台上开启了音频可视化功能，注意移动端safari有bug，如果没有声音的话，请关闭音频可视化功能",
            timeout: 5000
          })
        }
      }
    }
  },

  mounted () {
    this.initPlyr();
    this.initAudioAnalyzer();
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
   },
}
</script>

<style scoped>
</style>