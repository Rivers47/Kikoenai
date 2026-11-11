<template>
    <div
      v-if="hasVisibleLyric && showLyrics && !lyricsFullScreen"
      class="lyric-container"
      :style="containerStyle"
      ref="draggable"
    >
        <div class="fontSizeBar" :class="showSizeBar ? 'showSizeBarStyle' : 'hideSizeBarStyle'">
          <q-slider v-model="fontSize" :min="0.2" :max="10" :step="0" thumb-size="35px"/>
        </div>
        <div
          id="lyricsBar"
          class="text-center text-bold absolute-bottom non-selectable"
          @mousedown="onCursorDown"
          @touchstart="onCursorDown"
          :class="'text-on-surface-variant'">
          <div class="lyricBackground">
            <!-- One line per speaker, stacked. Speakers with nothing to say
                 right now are dropped rather than left as blank rows, and the
                 bar grows upwards, so the baseline never moves. -->
            <span
              v-for="(line, index) in currentLyrics"
              v-show="line !== ''"
              :key="index"
              class="lyric-line"
              :style="{'font-size': `${fontSize}rem`, color: lyricStreamColor(index, currentLyrics.length)}">
              <!-- Only WebVTT voice spans name their speaker; the other
                   formats have no such field and render text alone. -->
              <span v-if="lyricSpeakers[index]" class="lyric-speaker">{{lyricSpeakers[index]}}</span>
              {{line}}
            </span>
          </div>
        </div>
      </div>
</template>

<script>
import { mapState, mapMutations } from 'vuex'
import { lyricStreamColor } from 'src/utils/lyrics'

export default {
  name: 'LyricsBar',

  computed: {
    ...mapState('AudioPlayer', [
      'currentLyrics',
      'hide',
      'lyricSpeakers',
      'lyricFontSize',
      'lyricsFullScreen',
      'showLyrics'
    ]),

    hasVisibleLyric () {
      return this.currentLyrics.some(line => line !== '')
    },

    // Bound rather than written to the DOM: the element is destroyed whenever
    // the lyrics go quiet, and the position has to survive that.
    containerStyle () {
      if (this.pos) return { left: `${this.pos.left}px`, top: `${this.pos.top}px` }
      if (this.hide) return null // bar mode keeps the CSS default
      return { top: `${-this.panelOffset}px` }
    },

    // The slider and the full-screen view share one size, so a change in
    // either place moves the words in both.
    fontSize: {
      get () { return this.lyricFontSize },
      set (value) { this.setLyricFontSize(value) },
    },
  },

  data () {
    return {
      beTouched: false,

      // Where the user dragged the window to, in the same coordinates the
      // original DOM writes used. Kept in data because the element is destroyed
      // whenever the lyrics go quiet (a gap between cues), and a DOM-only
      // position would be lost with it.
      pos: null,

      // In panel mode the window sits just above the card's controls, i.e. above
      // the artwork. Measured, because the card's shape differs between the
      // phone (full screen) and desktop (bottom-right) layouts.
      panelOffset: 260,

      // 鼠标按下时的位置
      startX: 0,
      startY: 0,

      showSizeBar: false,
      laterTimer: 0,
    }
  },

  watch: {
    fontSize(newv, oldv) {
      if (oldv > 0) this.showTempSizeBar()
    },

    // The card changes shape with the mode, so re-measure as it appears.
    hide() {
      this.$nextTick(() => this.measurePanel())
    },
  },

  methods: {
    ...mapMutations('AudioPlayer', {
      setLyricFontSize: 'SET_LYRIC_FONT_SIZE',
    }),

    lyricStreamColor,

    // The lyric window shares its wrapper with the panel card, so the card's
    // artwork is the edge to sit above: everything interactive is below it.
    //
    // Layout metrics, not `getBoundingClientRect`: the card slides in and out
    // with a transform, and a rect read while it is off screen (or mid-slide)
    // reports a position far below the viewport, which flipped this offset
    // negative and put the window past the bottom edge.
    measurePanel() {
      const card = document.querySelector('.audio-player')
      const art = card && card.querySelector('.albumart')
      if (!art) return
      const margin = parseFloat(getComputedStyle(card).marginBottom) || 0
      const below = card.offsetHeight - (art.offsetTop + art.offsetHeight)
      const offset = Math.round(below + margin + 8)
      this.panelOffset = Math.min(Math.max(offset, 120), Math.max(120, window.innerHeight - 120))
    },

    showTempSizeBar() {
      // return // debug only
      clearTimeout(this.laterTimer);
      this.showSizeBar = true;
      this.laterTimer = setTimeout(() => {
        this.showSizeBar = false;
      }, 3 * 1000); // 延迟关闭滑块
    },

    /**
     * @param {TouchEvent|MouseEvent} ev
     */
    getTouch(ev) {
      return ev.touches ? ev.touches[0] : ev;
    },

    onCursorDown(ev) {
      this.showTempSizeBar()
      ev.preventDefault()
      this.beTouched = true

      // 移动端使用 ev.touches[0]
      const touch = this.getTouch(ev)
      this.startX = touch.clientX - this.$refs.draggable.offsetLeft
      this.startY = touch.clientY - this.$refs.draggable.offsetTop
    },

    onCursorUp(ev) {
      if (!this.beTouched) return
      ev.preventDefault()
      this.beTouched = false
    },

    onCursorMove(ev) {
      if (!this.beTouched) { return }
      const touch = this.getTouch(ev)

      // 计算 element 新位置坐标
      this.pos = {
        left: touch.clientX - this.startX,
        top: touch.clientY - this.startY,
      }
    },

  },

  mounted() {
    // addEventListener('mousemove', onCursorMove(this), false)
    // addEventListener('touchmove', onCursorMove(this), false)
    addEventListener('mousemove', this.onCursorMove)
    addEventListener('touchmove', this.onCursorMove)

    addEventListener('mouseup', this.onCursorUp)
    addEventListener('touchend', this.onCursorUp)
    addEventListener('touchcancel', this.onCursorUp)

    addEventListener('resize', this.measurePanel)
    this.measurePanel()
  },

  beforeUnmount() {
    removeEventListener('mousemove', this.onCursorMove)
    removeEventListener('touchmove', this.onCursorMove)

    removeEventListener('mouseup', this.onCursorUp)
    removeEventListener('touchend', this.onCursorUp)
    removeEventListener('touchcancel', this.onCursorUp)
    removeEventListener('resize', this.measurePanel)
  }
  
}
</script>

<style lang="scss">
  .lyric-container {
    position: relative;

    /* 水平位置置于中间 */
    left: 50vw;
    transform: translateX(-50%);

    top: -132px;
    
    display: flex;
    flex-direction: column;
    align-self: center;
  }

  .moveable-line {
    background-color: transparent !important;
  }
  #lyricsBar {
    position: relative;
    min-width: 1vw;
    max-width: 90vw;
  }

  /* Block-level so several speakers stack instead of running together on one
     line. */
  .lyric-line {
    display: block;
    white-space: pre-line;
  }

  /* Inline rather than on its own row, so the name costs no line of height.
     It inherits the speaker's colour and is toned down so the words still lead. */
  .lyric-speaker {
    font-size: 0.7em;
    opacity: 0.75;
    margin-inline-end: 0.4em;
  }
  
  .lyricBackground {
    border-radius: 10px;
    padding: 2px 4px;
    transition: 0.5s;
    backdrop-filter: blur(4px);
    background-color: rgb(var(--surface-container-highest-rgb) / 0.75);
  }
  .fontSizeBar {
    width: 300px;
    position: absolute;
    left: 50%;
    bottom: 0;

    transition: 0.5s;
  }

  .showSizeBarStyle {
    opacity: 1;
    transform: translateX(-50%) translateY(100%);
  }
  .hideSizeBarStyle {
    opacity: 0;
    transform: translateX(-50%) translateY(0);
    visibility: hidden;
  }
</style>
