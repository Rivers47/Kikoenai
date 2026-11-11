<template>
  <div
    v-if="visible"
    class="lyrics-full-screen"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend.passive="onTouchEnd"
  >
    <div class="backdrop" :style="backdropStyle" />
    <div class="wash" />

    <div class="top">
      <q-btn flat round dense class="chrome" icon="keyboard_arrow_down" @click="close()">
        <q-tooltip anchor="bottom middle" self="top middle">{{ t('lyricsfullscreen.close') }}</q-tooltip>
      </q-btn>
      <div class="titles">
        <div class="work">{{ currentPlayingFile.workTitle }}</div>
        <div class="track">{{ currentPlayingTitle }}<span v-if="trackMeta"> · {{ trackMeta }}</span></div>
      </div>
      <q-btn flat round dense class="chrome font-button">
        <span class="glyph">A</span>
        <q-tooltip anchor="bottom middle" self="top middle">{{ t('lyricsfullscreen.fontSize') }}</q-tooltip>
        <q-menu anchor="bottom right" self="top right">
          <div class="font-menu">
            <q-slider
              :model-value="lyricFontSize"
              :min="0.8"
              :max="3"
              :step="0.1"
              :label-value="`${Math.round(lyricFontSize * 100)}%`"
              color="primary"
              @update:model-value="setLyricFontSize"
            />
          </div>
        </q-menu>
      </q-btn>
    </div>

    <div v-if="!rows.length" class="empty">
      <q-icon name="closed_caption_off" size="md" />
    </div>

    <div
      v-else
      ref="scroller"
      class="rows"
      :style="{ '--row-size': `${lyricFontSize * 1.25}rem`, '--row-size-sm': `${lyricFontSize * 0.85}rem` }"
      @wheel.passive="stopFollowing"
      @touchmove.passive="stopFollowing"
    >
      <div
        v-for="row in displayRows"
        :key="row.id"
        class="lyric-row"
        :class="rowClass(row)"
        :style="{ color: row.color }"
        @click="seekTo(row)"
      >
        <span v-if="row.name" class="speaker">{{ row.name }}</span>{{ row.text }}
      </div>
    </div>

    <transition name="fade">
      <q-btn
        v-if="!following && displayRows.length"
        class="follow"
        rounded
        unelevated
        color="primary"
        icon="arrow_downward"
        :label="t('lyricsfullscreen.follow')"
        @click="resumeFollowing"
      />
    </transition>
  </div>
</template>

<script>
import { useI18n } from 'vue-i18n'
import { mapState, mapGetters, mapMutations } from 'vuex'
import { lyricStreamColor } from 'src/utils/lyrics'

// Where the followed line sits, as a share of the visible height.
const FOLLOW_ANCHOR = 0.38
const SWIPE_CLOSE_PX = 90

export default {
  name: 'LyricsFullScreen',

  setup () {
    const { t } = useI18n() // global scope
    return { t }
  },

  data () {
    return {
      following: true,
      swipe: null,
      pushedEntry: false,
    }
  },

  computed: {
    ...mapState('AudioPlayer', [
      'currentTime', 'lyricCues', 'lyricFontSize', 'lyricsFullScreen',
      'lyricOffsetSeconds', 'playWorkId', 'queue', 'queueIndex', 'showLyrics',
      'visualPlayerCoverUrl',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'currentPlayingTitle',
    ]),

    // One row per cue of every stream, in playback order. Several rows can be
    // active at once: a track voiced by two speakers interleaves their lines.
    rows () {
      const streams = this.lyricCues || []
      const rows = []
      streams.forEach((stream, streamIndex) => {
        (stream.cues || []).forEach((cue, cueIndex) => {
          const text = (cue.text || '').trim()
          if (!text) return
          rows.push({
            id: `${streamIndex}:${cueIndex}`,
            start: cue.start,
            end: cue.end === undefined ? Infinity : cue.end,
            text,
            name: stream.name || null,
            color: streams.length > 1 ? lyricStreamColor(streamIndex, streams.length) : undefined,
          })
        })
      })
      return rows.sort((a, b) => a.start - b.start)
    },

    nowMs () {
      return (this.currentTime + this.lyricOffsetSeconds) * 1000
    },

    activeIndex () {
      let found = -1
      for (let i = 0; i < this.rows.length; i++) {
        if (this.rows[i].start > this.nowMs) break
        found = i
      }
      return found
    },

    // The CC toggle silences the words, it does not close the view.
    displayRows () {
      return this.showLyrics ? this.rows : []
    },

    visible () {
      return this.lyricsFullScreen
    },

    backdropStyle () {
      return { backgroundImage: `url("${this.visualPlayerCoverUrl || ''}")` }
    },

    trackMeta () {
      return this.queue.length ? `${this.queueIndex + 1} / ${this.queue.length}` : ''
    },
  },

  watch: {
    visible: {
      immediate: true,
      handler (value) {
        if (value) this.onOpen()
        else this.following = true
      },
    },

    activeIndex () {
      if (this.following) this.scrollToActive('smooth')
    },

    // The rows are torn down while the CC is off, so the scroller loses its
    // position. Re-anchor as soon as they come back rather than waiting for the
    // next cue to change `activeIndex`.
    'displayRows.length' (length) {
      if (!length || !this.following) return
      this.$nextTick(() => this.scrollToActive('auto'))
    },
  },

  mounted () {
    window.addEventListener('keydown', this.onKeydown)
    window.addEventListener('popstate', this.onPopState)
  },

  beforeUnmount () {
    window.removeEventListener('keydown', this.onKeydown)
    window.removeEventListener('popstate', this.onPopState)
  },

  methods: {
    ...mapMutations('AudioPlayer', {
      setNewCurrentTime: 'SET_NEW_CURRENT_TIME',
      setLyricsFullScreen: 'SET_LYRICS_FULL_SCREEN',
      setLyricFontSize: 'SET_LYRIC_FONT_SIZE',
    }),

    rowClass (row) {
      if (row.end <= this.nowMs) return 'lyric-row--past'
      if (row.start > this.nowMs) return 'lyric-row--future'
      return 'lyric-row--active'
    },

    // Cue times are on the lyric clock; the offset maps them onto the media.
    seekTo (row) {
      this.setNewCurrentTime(Math.max(0, row.start / 1000 - this.lyricOffsetSeconds))
      this.following = true
    },

    scrollToActive (behavior) {
      const scroller = this.$refs.scroller
      if (!scroller || this.activeIndex < 0) return
      const node = scroller.children[this.activeIndex]
      if (!node) return
      const top = node.offsetTop - scroller.clientHeight * FOLLOW_ANCHOR
      scroller.scrollTo({ top: Math.max(0, top), behavior })
    },

    stopFollowing () {
      this.following = false
    },

    resumeFollowing () {
      this.following = true
      this.scrollToActive('smooth')
    },

    onOpen () {
      this.following = true
      this.$nextTick(() => this.scrollToActive('auto'))
      this.pushHistoryEntry()
    },

    // Back closes the overlay instead of leaving the page behind it.
    pushHistoryEntry () {
      if (this.pushedEntry) return
      try {
        history.pushState({ ...(history.state || {}), lyricsFullScreen: true }, '')
        this.pushedEntry = true
      } catch (error) {
        this.pushedEntry = false
      }
    },

    onPopState () {
      if (this.lyricsFullScreen) this.close(true)
    },

    close (fromHistory = false) {
      this.setLyricsFullScreen(false)
      const popped = fromHistory || !this.pushedEntry
      this.pushedEntry = false
      if (!popped) history.back()
    },

    onKeydown (event) {
      if (event.key !== 'Escape' || !this.visible) return
      event.preventDefault()
      this.close()
    },

    // A downward swipe dismisses the view, but only from the header or from the
    // very top of the list: anywhere else the gesture is a scroll.
    onTouchStart (event) {
      const scroller = this.$refs.scroller
      const touch = event.touches[0]
      const fromHeader = Boolean(event.target.closest && event.target.closest('.top'))
      const armed = fromHeader || (scroller && scroller.scrollTop <= 0)
      this.swipe = touch && armed ? { y: touch.clientY } : null
    },

    onTouchMove (event) {
      if (!this.swipe) return
      const touch = event.touches[0]
      if (!touch) return
      const dy = touch.clientY - this.swipe.y
      if (dy > SWIPE_CLOSE_PX) {
        this.swipe = null
        this.close()
      } else if (dy < 0) {
        this.swipe = null
      }
    },

    onTouchEnd () {
      this.swipe = null
    },
  },
}
</script>

<style lang="scss">
/* Above the floating player wrapper (3001), below the docked bar (3100): the
   bar stays visible and clickable while the lyrics take the rest. */
.lyrics-full-screen {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: calc(128px + env(safe-area-inset-bottom));
  z-index: 3050;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: rgb(var(--on-surface-rgb));
}

.backdrop {
  position: absolute;
  inset: -10%;
  background-position: center;
  background-size: cover;
  filter: blur(60px) saturate(0.6);
}

.wash {
  position: absolute;
  inset: 0;
  background-color: rgb(var(--surface-rgb) / 0.7);
}

.top {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 12px 0;
}

.chrome {
  background-color: rgb(var(--surface-container-highest-rgb) / 0.9);
  color: rgb(var(--on-surface-variant-rgb));
  flex: none;
}

.font-button .glyph {
  font-size: 18px;
  font-weight: 600;
}

.font-menu {
  width: 200px;
  padding: 8px 14px;
}

.empty {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--on-surface-variant-rgb));
  opacity: 0.7;
}

.rows {
  position: relative;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* Room for the first and last lines to sit at the follow anchor. */
  padding: 30vh 24px;
  scrollbar-width: none;
}

.rows::-webkit-scrollbar {
  display: none;
}

.titles {
  flex: 1;
  min-width: 0;
  padding-top: 4px;
  text-align: center;
}

.work,
.track {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work {
  font-size: 15px;
  font-weight: 600;
}

.track {
  font-size: 12.5px;
  color: rgb(var(--on-surface-variant-rgb));
}

.lyric-row {
  max-width: 760px;
  margin: 0 auto;
  padding: 8px 0 8px 14px;
  border-inline-start: 3px solid transparent;
  font-size: var(--row-size);
  line-height: 1.35;
  white-space: pre-line;
  overflow-wrap: break-word;
  cursor: pointer;
  transition: opacity 150ms;
}

.lyric-row--past {
  opacity: 0.7;
}

.lyric-row--future {
  opacity: 0.3;
}

.lyric-row--active {
  opacity: 1;
  font-weight: 600;
  border-inline-start-color: rgb(var(--primary-rgb) / 0.5);
}

.speaker {
  margin-inline-end: 12px;
  font-size: 0.62em;
  font-weight: 600;
  opacity: 0.85;
}

.follow {
  position: absolute;
  right: 24px;
  bottom: 24px;
  z-index: 2;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 599px) {
  .lyrics-full-screen {
    bottom: calc(84px + env(safe-area-inset-bottom));
  }

  .rows {
    padding: 28vh 16px;
  }

  .lyric-row {
    font-size: var(--row-size-sm);
  }

  .work {
    font-size: 13px;
  }

  .track {
    font-size: 11px;
  }

  .follow {
    right: 16px;
    bottom: 16px;
  }
}
</style>
