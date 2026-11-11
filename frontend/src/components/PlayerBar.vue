<template>
  <div
    class="docked-bar non-selectable"
    :class="{ 'docked-bar--hidden': !visible, 'docked-bar--seeking': seeking, 'docked-bar--behind': behindDrawer }"
    :style="{ left: `${leftOffset}px` }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent
  >
    <div
      class="rail"
      ref="rail"
      @pointerenter="railHovered = true"
      @pointerleave="railHovered = false"
    >
      <div class="rail-bar">
        <div class="rail-fill" :style="{ width: `${progressPercent}%` }"></div>
        <div
          v-if="seeking"
          class="rail-preview"
          :style="{ width: `${previewPercent}%` }"
        ></div>
      </div>
      <span
        v-if="seekUndoVisible"
        class="rail-undo"
        :style="{ left: `${seekUndoPercent}%` }">
      </span>
      <div
        v-if="seeking || railHovered"
        class="rail-thumb"
        :style="{ left: `${seeking ? previewPercent : progressPercent}%` }"
      ></div>
      <span v-if="seeking" class="rail-bubble" :style="{ left: `${previewPercent}%` }">
        {{ formatSeconds(previewTime) }}
      </span>
    </div>

    <!-- The bar slides out of view in panel mode; its pill must go with it. -->
    <SeekUndoPill v-if="visible" class="bar-seek-undo" />

    <div class="body">
      <div class="cover" @pointerdown.stop @click.stop="openWorkDetail">
        <q-img :src="coverUrl" :ratio="1" class="cover-img" transition="fade" />
      </div>

      <div class="main">
        <div class="texts">
          <div class="title-row">
            <Scrollable class="title-scroll" :stop="!hide" name="barTitle">
              <span class="title">{{ currentPlayingTitle }}</span>
            </Scrollable>
            <span class="meta" v-if="queueLength">
              <span class="meta-index">{{ trackIndex }}</span>
              <span class="meta-total">{{ formatSeconds(workDuration) }}</span>
            </span>
          </div>
          <Scrollable class="track-scroll" :stop="!hide" name="barTrack">
            <span class="track">{{ currentPlayingFile.workTitle }}</span>
          </Scrollable>
          <div class="vas" v-if="vaNames">
            <q-icon name="mic" class="va-icon" />
            <span>{{ vaNames }}</span>
          </div>
        </div>

        <div class="transport" @pointerdown.stop>
          <span class="time">{{ formatSeconds(currentTime) }}</span>
          <q-btn flat round dense class="seek" :icon="rewindIcon" @click="rewind(true)">
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ t('playerbar.rewind', { seconds: rewindSeekTime }) }}
            </q-tooltip>
          </q-btn>
          <q-btn flat round dense class="skip" icon="skip_previous" @click="previousTrack()" />
          <q-btn
            round
            unelevated
            class="play"
            color="primary"
            text-color="on-primary"
            :icon="playing ? 'pause' : 'play_arrow'"
            @click="togglePlaying()"
          />
          <q-btn flat round dense class="skip" icon="skip_next" @click="nextTrack()" />
          <q-btn flat round dense class="seek" :icon="forwardIcon" @click="forward(true)">
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ t('playerbar.forward', { seconds: forwardSeekTime }) }}
            </q-tooltip>
          </q-btn>
          <span class="time time--total">{{ formatSeconds(duration) }}</span>
        </div>

        <div class="actions" @pointerdown.stop>
          <q-btn flat round dense class="action" icon="queue_music" @click="toggleQueueDialog()">
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ t('audioplayer.switchTrack') }}
            </q-tooltip>
          </q-btn>

          <q-btn
            flat
            round
            dense
            class="action"
            :class="{ 'action--on': showLyrics && hasLyric }"
            :disable="!hasLyric"
            icon="closed_caption"
            @click="toggleLyrics()"
          >
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ hasLyric ? t('playerbar.lyrics') : t('playerbar.noLyrics') }}
            </q-tooltip>
          </q-btn>

          <q-btn v-if="!narrow" flat round dense class="action" :icon="playModeIcon" @click="changePlayMode()">
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ playModeString }}
            </q-tooltip>
          </q-btn>

          <q-btn
            v-if="!narrow"
            flat
            round
            dense
            class="action"
            :class="{ 'action--on': sleepMode }"
            icon="snooze"
            @click="showSleepTimer = true"
          >
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ sleepTimerTooltip }}
            </q-tooltip>
          </q-btn>

          <q-btn
            v-if="showVolume"
            flat
            round
            dense
            class="action"
            :icon="volumeIcon"
          >
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ t('playerbar.volume') }}
            </q-tooltip>
            <q-menu anchor="top middle" self="bottom middle" :offset="[0, 8]">
              <div class="volume-menu row items-center no-wrap">
                <q-btn flat round dense :icon="volumeIcon" @click="toggleMuted()" />
                <q-slider
                  :model-value="volume"
                  :min="0"
                  :max="1"
                  :step="0.01"
                  color="primary"
                  class="col q-ml-sm"
                  @update:model-value="setVolume"
                />
              </div>
            </q-menu>
          </q-btn>

          <q-btn
            flat
            round
            dense
            class="action"
            :class="{ 'action--on': lyricsFullScreen }"
            :icon="lyricsFullScreen ? 'close_fullscreen' : 'open_in_full'"
            @click="toggleLyricsFullScreen()"
          >
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ lyricsFullScreen ? t('lyricsfullscreen.close') : t('lyricsfullscreen.open') }}
            </q-tooltip>
          </q-btn>

          <q-btn flat round dense class="action action--more" icon="more_horiz">
            <q-tooltip anchor="top middle" self="bottom middle">
              {{ t('audioplayer.moreSettings') }}
            </q-tooltip>
            <q-menu anchor="top right" self="bottom right">
              <q-list dense style="min-width: 15rem">
                <template v-if="compact || narrow">
                  <!-- Each entry appears only while its button is off the bar:
                       phones hide everything but ⋯, narrow desktop folds play
                       mode and the sleep timer. -->
                  <q-item v-if="compact" clickable v-ripple @click="toggleQueueDialog()" v-close-popup>
                    <q-item-section avatar><q-icon name="queue_music" /></q-item-section>
                    <q-item-section>{{ t('audioplayer.switchTrack') }}</q-item-section>
                  </q-item>
                  <q-item v-if="compact" clickable v-ripple @click="openPanel()" v-close-popup>
                    <q-item-section avatar><q-icon name="open_in_full" /></q-item-section>
                    <q-item-section>{{ t('audioplayer.openPanel') }}</q-item-section>
                  </q-item>
                  <q-item v-if="compact" clickable v-ripple :disable="!hasLyric" @click="toggleLyrics()" v-close-popup>
                    <q-item-section avatar><q-icon name="closed_caption" /></q-item-section>
                    <q-item-section>
                      {{ hasLyric ? t('playerbar.lyrics') : t('playerbar.noLyrics') }}
                    </q-item-section>
                    <q-item-section side v-if="showLyrics && hasLyric"><q-icon name="check" /></q-item-section>
                  </q-item>
                  <q-item v-if="narrow" clickable v-ripple @click="changePlayMode()" v-close-popup>
                    <q-item-section avatar><q-icon :name="playModeIcon" /></q-item-section>
                    <q-item-section>{{ playModeString }}</q-item-section>
                  </q-item>
                  <q-item v-if="narrow" clickable v-ripple @click="showSleepTimer = true" v-close-popup>
                    <q-item-section avatar><q-icon name="snooze" /></q-item-section>
                    <q-item-section>{{ sleepTimerTooltip }}</q-item-section>
                  </q-item>
                  <!-- The volume button only fits on wide bars, so below that
                       the same control lives here instead of vanishing. -->
                  <q-item v-if="volumeInMenu" dense>
                    <q-item-section avatar>
                      <q-btn flat round dense :icon="volumeIcon" @click="toggleMuted()" />
                    </q-item-section>
                    <q-item-section>
                      <q-slider
                        :model-value="volume"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        color="primary"
                        @update:model-value="setVolume"
                      />
                    </q-item-section>
                  </q-item>
                  <q-item
                    v-if="compact"
                    clickable
                    v-ripple
                    @click="toggleLyricsFullScreen"
                    v-close-popup
                  >
                    <q-item-section avatar>
                      <q-icon :name="lyricsFullScreen ? 'close_fullscreen' : 'open_in_full'" />
                    </q-item-section>
                    <q-item-section>
                      {{ lyricsFullScreen ? t('lyricsfullscreen.close') : t('lyricsfullscreen.open') }}
                    </q-item-section>
                  </q-item>
                </template>
              </q-list>
            </q-menu>
          </q-btn>
        </div>
      </div>
    </div>

    <SleepMode v-model="showSleepTimer" />
  </div>
</template>

<script>
import { useI18n } from 'vue-i18n'
import { mapState, mapGetters, mapMutations } from 'vuex'
import SleepMode from 'components/SleepMode'
import Scrollable from 'components/Scrollable'
import SeekUndoPill from 'components/SeekUndoPill'
import { useSeekUndo } from 'src/utils/seek-undo'
import { formatSeconds } from '../utils'
import { apiUrl } from 'src/base-path'

const DRAG_THRESHOLD_PX = 8
const SWIPE_UP_PX = 18

export default {
  name: 'PlayerBar',
  components: {
    SleepMode,
    Scrollable,
    SeekUndoPill,
  },

  props: {
    // Width of the drawer the bar must clear, in px (MainLayout owns that state).
    leftOffset: {
      type: Number,
      default: 0,
    },
    // Modal drawer open (< 500px): the bar belongs under its backdrop.
    behindDrawer: {
      type: Boolean,
      default: false,
    },
  },

  setup () {
    const { t } = useI18n()
    const { visible, percent } = useSeekUndo()
    return { t, seekUndoVisible: visible, seekUndoPercent: percent }
  },

  data () {
    return {
      showSleepTimer: false,
      seeking: false,
      railHovered: false,
      previewTime: 0,
      drag: null,
      railRect: null,
    }
  },

  computed: {
    ...mapState('AudioPlayer', [
      'hide',
      'playing',
      'currentTime',
      'duration',
      'rewindSeekTime',
      'forwardSeekTime',
      'playMode',
      'sleepMode',
      'sleepModeType',
      'sleepStopAt',
      'sleepTracksLeft',
      'queue',
      'queueIndex',
      'playWorkId',
      'playWorkVas',
      'visualPlayerCoverUrl',
      'showLyrics',
      'hasLyric',
      'lyricsFullScreen',
      'muted',
      'volume',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile',
      'currentPlayingTitle',
    ]),

    visible () {
      return Boolean(this.currentPlayingFile.trackId) && this.hide
    },

    coverUrl () {
      // A user-picked cover is a media URL and is used as-is. The generated one is
      // the full-size `main` cover, so ask for the small variant the bar draws.
      const custom = this.visualPlayerCoverUrl
      if (custom && !custom.includes('/api/cover/')) return custom
      return this.playWorkId ? apiUrl(`/api/cover/${this.playWorkId}?type=sam`) : custom
    },

    queueLength () {
      return this.queue.length
    },

    trackIndex () {
      return this.queueLength ? `${this.queueIndex + 1} / ${this.queueLength}` : ''
    },

    workDuration () {
      return this.queue.reduce((total, track) => total + (track.duration || 0), 0)
    },

    progressPercent () {
      if (!this.duration) return 0
      return (this.currentTime / this.duration) * 100
    },

    previewPercent () {
      if (!this.duration) return 0
      return (this.previewTime / this.duration) * 100
    },

    // Play mode and the sleep timer live in ⋯ once the bar is too narrow for
    // the full cluster to sit clear of the centred transport.
    narrow () {
      return this.$q.screen.lt.md
    },

    // Phones have hardware volume keys; below 1024px the cluster would reach
    // the transport, so the bar only carries the control on wide screens.
    showVolume () {
      return this.$q.platform.is.desktop && this.$q.screen.gt.sm
    },

    // Phones have hardware keys and no volume UI at all; a narrow desktop gets
    // the control in the menu instead of nowhere.
    volumeInMenu () {
      return this.$q.platform.is.desktop && !this.showVolume
    },

    volumeIcon () {
      if (this.muted || this.volume === 0) return 'volume_off'
      return this.volume < 0.5 ? 'volume_down' : 'volume_up'
    },

    // Phones fold every secondary action into the overflow menu.
    compact () {
      return this.$q.screen.lt.sm
    },

    vaNames () {
      return (this.playWorkVas || []).map(va => va.name).filter(Boolean).join('、')
    },

    rewindIcon () {
      switch (this.rewindSeekTime) {
        case 10: return 'replay_10'
        case 30: return 'replay_30'
        default: return 'replay_5'
      }
    },

    forwardIcon () {
      switch (this.forwardSeekTime) {
        case 10: return 'forward_10'
        case 30: return 'forward_30'
        default: return 'forward_5'
      }
    },

    playModeIcon () {
      switch (this.playMode.name) {
        case 'all repeat': return 'repeat'
        case 'repeat once': return 'repeat_one'
        case 'shuffle': return 'shuffle'
        default: return 'playlist_play'
      }
    },

    playModeString () {
      switch (this.playMode.name) {
        case 'all repeat': return this.t('audioplayer.playModeAllRepeat')
        case 'repeat once': return this.t('audioplayer.playModeRepeatOnce')
        case 'shuffle': return this.t('audioplayer.playModeShuffle')
        default: return this.t('audioplayer.playModeOrder')
      }
    },

    sleepTimerTooltip () {
      if (!this.sleepMode) return this.t('audioplayer.sleepTimer')
      if (this.sleepModeType === 'minutes' && this.sleepStopAt) {
        const date = new Date(this.sleepStopAt)
        return this.t('audioplayer.sleepTimerStopAt', {
          hour: date.getHours(),
          min: String(date.getMinutes()).padStart(2, '0'),
        })
      }
      return this.t('audioplayer.sleepTimerTracksLeft', { count: this.sleepTracksLeft })
    },
  },

  methods: {
    ...mapMutations('AudioPlayer', {
      toggleHide: 'TOGGLE_HIDE',
      togglePlaying: 'TOGGLE_PLAYING',
      nextTrack: 'NEXT_TRACK',
      previousTrack: 'PREVIOUS_TRACK',
      rewind: 'SET_REWIND_SEEK_MODE',
      forward: 'SET_FORWARD_SEEK_MODE',
      setNewCurrentTime: 'SET_NEW_CURRENT_TIME',
      armSeekUndo: 'ARM_SEEK_UNDO',
      changePlayMode: 'CHANGE_PLAY_MODE',
      toggleLyrics: 'TOGGLE_LYRICS',
      toggleQueueDialog: 'TOGGLE_QUEUE_DIALOG',
      setLyricsFullScreen: 'SET_LYRICS_FULL_SCREEN',
      toggleMuted: 'TOGGLE_MUTED',
      setVolume: 'SET_VOLUME',
    }),

    formatSeconds,

    toggleLyricsFullScreen () {
      this.setLyricsFullScreen(!this.lyricsFullScreen)
    },

    // The floating panel is the phone's player: above 600px the docked bar is
    // the whole UI and there is deliberately no way to open it.
    openPanel () {
      if (!this.compact || !this.hide) return
      this.toggleHide()
    },

    openWorkDetail () {
      const trackId = this.currentPlayingFile.trackId
      if (!trackId) return
      const url = `/work/${trackId.split('/')[0]}`
      if (this.$route.path !== url) this.$router.push(url)
    },

    onPointerDown (event) {
      if (event.target.closest('.q-btn')) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const rail = this.$refs.rail
      if (!rail) return
      this.railRect = rail.getBoundingClientRect()
      // A press on the rail is a seek from the first frame -- a click there must
      // scrub, not open the panel.
      const onRail = Boolean(event.target.closest('.rail'))
      this.drag = { x0: event.clientX, y0: event.clientY, mode: onRail ? 'seek' : null }
      if (onRail) this.previewAt(event.clientX)
    },

    // Only the rail counts as a seek: the ±seconds buttons and the lyric rows
    // are deliberate jumps, not browsing.
    seekTo (seconds) {
      if (Math.abs(seconds - this.currentTime) >= 1) {
        this.armSeekUndo({ time: this.currentTime, at: Date.now() })
      }
      this.setNewCurrentTime(seconds)
    },

    previewAt (clientX) {
      if (!this.railRect || !this.railRect.width || !this.duration) return
      const ratio = (clientX - this.railRect.left) / this.railRect.width
      this.previewTime = Math.min(this.duration, Math.max(0, ratio * this.duration))
      this.seeking = true
    },

    onPointerMove (event) {
      if (!this.drag) return
      const dx = event.clientX - this.drag.x0
      const dy = event.clientY - this.drag.y0

      if (!this.drag.mode) {
        if (Math.abs(dx) >= DRAG_THRESHOLD_PX) this.drag.mode = 'seek'
        else if (dy <= -SWIPE_UP_PX && this.compact) {
          this.drag.mode = 'swipe'
          this.openPanel()
        }
        else return
      }
      if (this.drag.mode !== 'seek') return
      this.previewAt(event.clientX)
    },

    onPointerUp () {
      if (this.drag) {
        if (this.drag.mode === 'seek' && this.seeking) this.seekTo(this.previewTime)
        // Only on phones: on a wide screen the panel has nothing to add, so a
        // tap on the bar is not a "open the big player" gesture.
        else if (!this.drag.mode && this.compact) this.openPanel()
      }
      this.drag = null
      this.seeking = false
      this.previewTime = 0
    },
  },
}
</script>

<style lang="scss" scoped>
.docked-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* Above the AudioPlayer/LyricsBar wrapper (z-index 3001) so a transformed
     panel can never sit invisibly over the transport and eat its clicks. */
  z-index: 3100;
  height: calc(128px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  background: rgb(var(--surface-container-lowest-rgb));
  color: rgb(var(--on-surface-rgb));
  transition: transform 0.3s ease;
  touch-action: none;
}

.docked-bar--hidden {
  transform: translateY(105%);
  pointer-events: none;
}

.docked-bar--behind {
  z-index: 1500;
}

/* 16px tall so the thin rail is still an easy grab target. */
.rail {
  --rail-height: 4px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 16px;
  cursor: pointer;
  touch-action: none;
}

.rail:hover,
.docked-bar--seeking .rail {
  --rail-height: 8px;
}

.rail-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--rail-height);
  background: rgb(var(--outline-variant-rgb));
  overflow: hidden;
  transition: height 0.12s ease;
}

.rail-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: rgb(var(--primary-rgb));
}

.rail-preview {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: rgb(var(--primary-rgb) / 0.45);
}

/* Ghost handle: where the undo pill would take you. Hollow, so it never reads
   as the live position. */
.rail-undo {
  position: absolute;
  top: calc(var(--rail-height) / 2);
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 2px solid rgb(var(--primary-rgb));
  border-radius: 50%;
  background: rgb(var(--surface-rgb));
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Ringed so the handle still reads where it sits on top of the filled part. */
.rail-thumb {
  position: absolute;
  top: calc(var(--rail-height) / 2);
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 2px solid rgb(var(--surface-container-lowest-rgb));
  border-radius: 50%;
  background: rgb(var(--primary-rgb));
  transform: translate(-50%, -50%);
}

.rail-bubble {
  position: absolute;
  top: -26px;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 8px;
  background: rgb(var(--inverse-surface-rgb));
  color: rgb(var(--inverse-on-surface-rgb));
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.body {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 100%;
  padding: 0 16px;
}

/* Bar is 128px tall: 96px leaves 16px of air top and bottom. */
.cover {
  flex: none;
  width: 96px;
  height: 96px;
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
}

.cover-img {
  width: 100%;
  height: 100%;
}

/* Not a containing block on purpose: the transport and the actions below are
   positioned against the bar itself, so the transport is centred on the bar
   rather than on the space left over by the cover. */
.main {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding-top: 14px;
  box-sizing: border-box;
}

.texts {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* The marquee owns the width and the clipping; the span only carries type. */
.title-scroll {
  flex: 1 1 auto;
  min-width: 0;
}

.title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}

.meta {
  margin-left: auto;
  flex: none;
  display: flex;
  gap: 12px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

.meta-index {
  color: rgb(var(--outline-rgb));
}

.meta-total {
  color: rgb(var(--on-surface-variant-rgb));
}

.track-scroll {
  display: block;
  width: 100%;
}

.track {
  font-size: 13px;
  color: rgb(var(--on-surface-variant-rgb));
  white-space: nowrap;
}

.vas {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 14px;
  margin-top: 2px;
  font-size: 11px;
  color: rgb(var(--outline-rgb));
}

.va-icon {
  font-size: 12px;
}

.vas span {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Centred on the bar itself, not on the space left of the actions. */
.transport {
  position: absolute;
  left: 50%;
  bottom: calc(10px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
}

.time {
  min-width: 38px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--on-surface-variant-rgb));
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.time--total {
  text-align: left;
  color: rgb(var(--outline-rgb));
}

.seek,
.skip {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  flex: none;
}

.seek {
  color: rgb(var(--on-surface-variant-rgb));
}

.skip {
  color: rgb(var(--on-surface-rgb));
}

/* The visual circle must be the whole hit area: pinned size, no overflow from
   the oversized glyph, and above its neighbours in the stack. */
.play {
  position: relative;
  z-index: 1;
  flex: none;
  width: 52px;
  height: 52px;
  min-width: 52px;
  min-height: 52px;
  padding: 0;
  overflow: hidden;
}

.play :deep(.q-icon) {
  font-size: 24px;
}

/* Above the bar, clear of the rail thumb, flush with the action cluster. */
.bar-seek-undo {
  position: absolute;
  right: 16px;
  bottom: 100%;
  margin-bottom: 16px;
  z-index: 1;
}

.volume-menu {
  width: 176px;
  padding: 4px 12px 4px 4px;
}

.actions {
  position: absolute;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  gap: 2px;
}

.action {
  width: 40px;
  height: 40px;
  min-width: 40px;
  min-height: 40px;
  color: rgb(var(--on-surface-variant-rgb));
}

.action--on {
  color: rgb(var(--primary-rgb));
}

/* Quasar marks a disabled button with a bare `disabled` class at 0.7 !important;
   0.7 reads as "hovered" rather than "unavailable", so this has to win the same way. */
.action.q-btn--disabled,
.action.disabled {
  opacity: 0.38 !important;
  color: rgb(var(--outline-rgb));
}

// The numeric times are the widest part of the transport, then the seek
// buttons: dropping each in turn keeps the centred transport clear of the
// action cluster all the way down to the 600px bar breakpoint.
@media (max-width: 899px) {
  .time {
    display: none;
  }
}

@media (max-width: 799px) {
  .seek {
    display: none;
  }
}

@media (max-width: 599px) {
  .docked-bar {
    height: calc(84px + env(safe-area-inset-bottom));
  }

  .body {
    gap: 10px;
    padding: 0 12px;
  }

  .cover {
    width: 44px;
    height: 44px;
    border-radius: 8px;
  }

  .main {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 0;
  }

  .texts {
    flex: 1;
    min-width: 0;
  }

  .bar-seek-undo {
    right: 12px;
    margin-bottom: 12px;
  }

  .transport,
  .actions {
    position: static;
    transform: none;
    margin-left: auto;
  }

  .title {
    font-size: 13px;
  }

  .track {
    font-size: 11px;
  }

  .meta,
  .vas,
  .time,
  .seek {
    display: none;
  }

  .transport {
    gap: 4px;
  }

  .skip {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
  }

  .play {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
  }

  .play :deep(.q-icon) {
    font-size: 26px;
  }

  .actions {
    gap: 0;
    margin-left: 0;
  }

  .action:not(.action--more) {
    display: none;
  }
}
</style>
