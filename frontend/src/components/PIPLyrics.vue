<template>
  <div :class="visibility" class="topClass">
    <canvas ref="canvas" class="sized"></canvas>
    <video ref="video" class="sized" muted="muted" playsinline preload="metadata" controls="controls" style="display: inline;"></video>
  </div>
</template>

<script>
import { mapState, mapMutations, mapGetters } from 'vuex'
import { debounce } from 'quasar';
import { lyricStreamColorVar } from 'src/utils/lyrics'

// Initial canvas aspect ratio (width : height). Once the PiP window opens the
// canvas is resized to the window's own dimensions; this only sets the shape of
// the very first frames. Kept in sync with `.sized` in the style block below.
const CANVAS_ASPECT = 500 / 60

// Font size is derived from the canvas area so that roughly EXPECT_CHAR_COUNT
// glyphs tile the surface; FONT_SCALE trims that estimate to leave some air.
const FONT_SCALE = 0.7
const EXPECT_CHAR_COUNT = 30

const PAD_WIDTH = 5

// Number of frames painted up front so the video element reaches `loadedmetadata`
// and can enter picture-in-picture without a delay on the user's click.
const FORCE_DRAW_FRAMES = 5

export default {
  name: 'PIPLyrics',

  computed: {
    video() {
      return this.$refs.video;
    },

    canvas() {
      return this.$refs.canvas
    },

    ...mapState('AudioPlayer', [
      'currentLyrics',
      'lyricSpeakers',
      'enablePIPLyrics',
      'playing',
    ]),

    ...mapGetters('AudioPlayer', [
      'isQueueEmpty',
    ]),
  },

  data () {
    return {
      ctx: null,
      visibility: "hide",
      // Swap the line above for "show" to render the canvas in the page at the
      // top-left corner — handy for debugging the painting without opening PiP.
      isFireFox: navigator.userAgent.toLowerCase().indexOf('firefox') > -1,
      // Whether the video element is ready to enter picture-in-picture. Entering
      // too early (user clicks faster than the video loads) silently fails.
      isVideoCanPlay: false,
      pixelRatio: window.devicePixelRatio,
      pipWindow: null,
    }
  },

  methods: {
    initCanvas() {
      const canvas = this.$refs.canvas
      this.ctx = canvas.getContext("2d")
      canvas.width = this.pixelRatio * window.innerWidth
      canvas.height = Math.round(canvas.width / CANVAS_ASPECT)
    },

    /**
     * Greedy line breaker. Canvas 2D has no text layout at all — fillText draws
     * a single run at a single point — so wrapping has to be done by hand.
     * Returns at most maxLines lines, the last ellipsised if text is left over.
     */
    wrapText(str, maxWidth, maxLines) {
      const ctx = this.ctx
      const chars = Array.from(str) // Array.from keeps surrogate pairs intact
      const lines = []
      let i = 0

      while (i < chars.length && lines.length < maxLines) {
        let line = ''
        while (i < chars.length && ctx.measureText(line + chars[i]).width <= maxWidth) {
          line += chars[i++]
        }
        // A single glyph wider than the whole line would otherwise loop forever.
        if (line === '') line = chars[i++]
        lines.push(line)
      }

      if (i < chars.length && lines.length > 0) {
        lines[lines.length - 1] = this.ellipsise(lines[lines.length - 1], maxWidth)
      }
      return lines
    },

    /**
     * Trim a line until it fits with an ellipsis appended. Measured rather than
     * counted: the old code dropped a fixed 3 characters, which is wildly wrong
     * for CJK, where three fullwidth glyphs are many times the width of "…".
     */
    ellipsise(line, maxWidth) {
      const ctx = this.ctx
      const chars = Array.from(line)
      while (chars.length > 0 && ctx.measureText(chars.join('') + '…').width > maxWidth) {
        chars.pop()
      }
      return chars.join('') + '…'
    },

    /**
     * Paint the currently sounding line of every lyric stream, one colour per
     * speaker, stacked in the same order as the in-page lyric bar, each
     * prefixed with its speaker's name where the format supplied one.
     * @param {string[]} streams one entry per speaker; empty entries are skipped
     */
    drawLyrics(streams) {
      const cvs = this.$refs.canvas
      const ctx = this.ctx
      if (!ctx) return

      const fontSize = FONT_SCALE * Math.round(Math.sqrt((cvs.width * cvs.height) / EXPECT_CHAR_COUNT))

      const bodyStyle = getComputedStyle(document.body)
      const themeVar = (name) => bodyStyle.getPropertyValue(name).trim()

      ctx.clearRect(0, 0, cvs.width, cvs.height)
      ctx.fillStyle = themeVar('--surface-container-highest')
      ctx.fillRect(0, 0, cvs.width, cvs.height)

      // A canvas gets no cascade, so sample the app's own stack off <body>
      // rather than hardcoding one. The old literal led with PingFang SC /
      // Hiragino Sans GB — both Simplified-Chinese faces — which preempted
      // fallback and drew Japanese kanji with Chinese glyph shapes.
      ctx.font = `bold ${fontSize}px ${bodyStyle.fontFamily || 'sans-serif'}`

      const total = streams.length
      const speaking = streams
        .map((text, index) => ({ text: String(text ?? ''), index }))
        .filter(stream => stream.text !== '')
        .map((stream) => {
          // The name is folded into the text rather than drawn as a separate
          // run: the canvas has no text layout, so a second run would need its
          // own measuring and wrapping for no gain at this size. An ideographic
          // space keeps it legible in both CJK and Latin faces.
          const name = this.lyricSpeakers[stream.index]
          return name ? { ...stream, text: `${name}\u3000${stream.text}` } : stream
        })

      const maxLines = Math.max(1, Math.floor(cvs.height / fontSize))
      // The PiP window is a couple of lines tall, so share the budget between
      // whoever is speaking rather than letting the first speaker fill it.
      const linesPerStream = Math.max(1, Math.floor(maxLines / Math.max(1, speaking.length)))
      const lines = []
      speaking.forEach((stream) => {
        this.wrapText(stream.text, cvs.width - PAD_WIDTH * 2, linesPerStream)
          .forEach(line => lines.push({ line, color: themeVar(lyricStreamColorVar(stream.index, total)) }))
      })

      // Centre the block of lines vertically.
      const topOffset = (cvs.height - lines.length * fontSize) / 2
      lines.forEach(({ line, color }, index) => {
        const metrics = ctx.measureText(line)
        const x = PAD_WIDTH + (cvs.width - metrics.width) / 2
        const y = topOffset + index * fontSize + metrics.actualBoundingBoxAscent
        ctx.fillStyle = color
        ctx.fillText(line, x, y)
      })

      this.pushFrame()
    },

    /** Hand the freshly painted canvas to the captured MediaStream. */
    pushFrame() {
      const stream = this.video && this.video.srcObject
      if (!stream) return
      stream.getTracks().forEach((track) => track.requestFrame && track.requestFrame())
    },

    initVideos() {
      this.video.srcObject = this.$refs.canvas.captureStream()

      this.isVideoCanPlay = true;
      this.video.addEventListener("loadedmetadata", () => {
        this.isVideoCanPlay = true;
      })
      this.video.addEventListener("enterpictureinpicture", (event) => {
        this.pipWindow = event.pictureInPictureWindow
        this.pipWindow.onresize = () => {
          this.onPipWindowResize()
        }
        setTimeout(() => this.onPipWindowResize(), 500)
      })
      this.video.addEventListener("leavepictureinpicture", () => {
        if (!this.stopPIPLyric) return // the component has already been destroyed
        this.stopPIPLyric()
        this.setEnablePIPLyrics(false)
        this.pipWindow = null
      })
      this.video.play()
      this.forceVideoStartLoadMetadata()
    },

    onPipWindowResize() {
      if (!this.pipWindow) return
      this.canvas.width = Math.round(this.pixelRatio * this.pipWindow.width);
      this.canvas.height = Math.round(this.pixelRatio * this.pipWindow.height);
      this.drawLyrics(this.currentLyrics)
    },

    forceVideoStartLoadMetadata() {
      // Paint a few frames immediately so the video reaches `loadedmetadata` and
      // picture-in-picture can be entered without waiting.
      let remaining = FORCE_DRAW_FRAMES
      const draw = () => {
        if (remaining < 0) {
          // Forced rendering is over — let the audio player decide from here.
          if (!this.enablePIPLyrics || !this.playing) this.video.pause()
          return;
        }
        remaining--
        requestAnimationFrame(draw)
        this.drawLyrics(this.currentLyrics)
      }
      requestAnimationFrame(draw)
    },

    openPIPVideoMode() {
      this.video.play()

      if (
        typeof this.video.requestPictureInPicture === 'function' &&
        document.pictureInPictureEnabled
      ) {
        this.video.requestPictureInPicture().then(() => {
          // Relay the PiP window's own play/pause controls back to the audio player.
          if (!this.playing) this.video.pause()
          this.video.onplay = () => {
            this.syncPlayingStateFromPIPVideoToAudio(true);
          };
          this.video.onpause = () => {
            this.syncPlayingStateFromPIPVideoToAudio(false);
          };
        }).catch((err) => {
          console.log("PIP lyric open video failed, msg = ", err.message)
          this.stopPIPLyric()
        })
      } else if (typeof this.video.webkitSetPresentationMode === 'function') {
        // Older WebKit (iOS Safari) predates requestPictureInPicture.
        this.video.webkitSetPresentationMode('picture-in-picture')
      }

      if (this.isFireFox) {
        // Firefox has no scripted way into picture-in-picture, so reveal the
        // video and let the user trigger it from the native control, then hide.
        this.visibility = "manulSet"
        setTimeout(() => {
          this.visibility = "hide"
        }, 10000)
      }
    },

    showUserPrompt() {
      let msg = this.$t('piplyrics.openConfirmMsg')
      let okMsg = this.$t('piplyrics.pleaseContinue')
      if (this.isFireFox) {
        msg = this.$t('piplyrics.firefoxMsg')
        okMsg = this.$t('piplyrics.gotIt')
      }

      this.$q.dialog({
        title: this.$t('piplyrics.desktopLyrics'),
        message: msg,
        ok: okMsg,
        cancel: this.$t('piplyrics.closeDesktopLyrics'),
        persistent: false
      }).onOk(() => {
        this.openPIPVideoMode()
      }).onCancel(() => {
        this.setEnablePIPLyrics(false)
        this.stopPIPLyric()
      })
    },

    stopPIPLyric() {
      const video = this.$refs.video
      if (!video) return
      if (typeof document.exitPictureInPicture === 'function') {
        document.pictureInPictureElement && document.exitPictureInPicture()
      } else if (typeof video.webkitSetPresentationMode === 'function') {
        video.webkitSetPresentationMode('inline')
      }
      video.pause()
      video.onplay = null;
      video.onpause = null;
    },

    ...mapMutations('AudioPlayer', {
      setEnablePIPLyrics: 'SET_ENABLE_PIP_LYRICS',
      playAudio: 'PLAY',
      pauseAudio: 'PAUSE',
    }),

    tryEnterPIPAndShowUserPrompt() {
      if (this.isVideoCanPlay) {
        this.showUserPrompt()
      } else {
        this.$q.notify({message: this.$t('piplyrics.openFailedMsg'), timeout: 500})
      }
    },

    syncPlayingStateFromAudioToPIPVideo() {
      if (!this.enablePIPLyrics) return;
      if (this.playing && this.video.paused) this.video.play()
      else if (!this.playing && !this.video.paused) this.video.pause()
    },

    syncPlayingStateFromPIPVideoToAudio(isPIPPlaying) {
      if (isPIPPlaying) this.playAudio()
      else this.pauseAudio()
    }
  },

  watch: {
    enablePIPLyrics(value) {
      if (!value) this.stopPIPLyric()
      else this.tryEnterPIPAndShowUserPrompt()
    },

    // The desktop lyrics can be switched on before anything is queued; when a
    // work finally starts playing, enter picture-in-picture at that point.
    isQueueEmpty(value) {
      if (value) this.stopPIPLyric()
      else if (this.enablePIPLyrics) this.tryEnterPIPAndShowUserPrompt()
    },
    currentLyrics(newLyrics) {
      if (!this.enablePIPLyrics) return
      this.drawLyrics(newLyrics)
    },
    playing() {
      this.syncPlayingStateFromAudioToPIPVideo()
      this.drawLyrics(this.currentLyrics);
    },
    "$q.dark.isActive"() {
      // Theme colours are sampled per paint, so redraw as soon as they change.
      this.drawLyrics(this.currentLyrics);
    }
  },

  created() {
    // Debounced to stop the video and the audio element from echoing each other:
    //  user ===play/pause---> PIP video --- play/pause ---> audio
    //                            ^                           |
    //                            |                           |
    //                            -------------play/pause-----`
    this.syncPlayingStateFromAudioToPIPVideo = debounce(this.syncPlayingStateFromAudioToPIPVideo, 500) // ms
    this.syncPlayingStateFromPIPVideoToAudio = debounce(this.syncPlayingStateFromPIPVideoToAudio, 500) // ms
    this.onPipWindowResize = debounce(this.onPipWindowResize, 100, true /*immediate*/)
  },

  mounted() {
    this.initCanvas()
    this.initVideos()
  },

  beforeUnmount() {
    this.stopPIPLyric()
  }
}
</script>

<style lang="scss" scoped>
  /* Display size of the source elements; matches CANVAS_ASPECT above. Only
     visible in the "show" / "manulSet" debug states — "hide" clips them. */
  .sized {
      width: 500px;
      height: 60px;
      border: 1px solid black;
      position: absolute;
  }

  .hide {
      opacity: 0.1;
      position: fixed;
      right: 5px;
      bottom: 5px;
      width: 5px;
      height: 5px;
      overflow: hidden;
  }
  .topClass {
    z-index: 999;
  }
  .show {
      opacity: 1.0;
      position: fixed;
      left: 0;
      top: 0;
  }

  .manulSet {
    opacity: 1.0;
    position: fixed;
    left: 0;
    top: 0;
    width: 100vw;
    height: 50vh;
  }

  .manulSet > canvas {
    display: none;
  }
</style>
