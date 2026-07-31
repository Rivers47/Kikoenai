<template>
  <q-dialog :model-value="visible" @update:model-value="onVisChange">
    <q-card class="sleep-mode-dialog" style="min-width: 300px">

      <!-- Header: title + current timer status -->
      <q-card-section class="row items-center q-pb-sm">
        <div class="text-h6">睡眠定时</div>
        <div v-if="sleepMode" class="text-subtitle2 q-ml-auto">
          {{ timerStatusText }}
        </div>
      </q-card-section>

      <!-- Body -->
      <q-card-section>
        
        <!-- Mode toggle -->
        <div class="text-center">
          <q-btn-toggle
            toggle-color="primary"
            text-color="primary"
            no-caps
            rounded
            unelevated
            v-model="currentMode"
            :options="[
              { label: '按分钟停止', value: 'minutes' },
              { label: '按曲目停止', value: 'tracks' }
            ]"
          />
        </div>

        <!-- Minutes mode -->
        <div v-if="currentMode === 'minutes'" class="q-mt-md">
          <div class="text-center q-mb-sm">
            <span class="text-body1 slider-label-value">{{ sliderLabel }}</span>
          </div>
          <q-slider
            v-model="sliderValue"
            :min="0"
            :max="90"
            :inner-min="5"
            :step="5"
            track-size="6px"
            :markers="15"
            :marker-labels="fnMarkerLabel"
            snap
            color="primary"
            class="picker-slider"
          />
        </div>

        <!-- Tracks mode -->
        <div v-else class="q-mt-md">
          <div class="text-center q-mb-sm">
            <span class="text-body1 slider-label-value">{{ trackValue }} 首</span>
          </div>
          <q-slider
            v-model="trackValue"
            :min="0"
            :max="fnGetRemainingTracks()"
            :step="1"
            snap
            :markers="1"
            color="primary"
            class="picker-slider"
          />
          
        </div>

      </q-card-section>

      <!-- Footer actions -->
      <div class="row justify-between items-center q-px-lg q-pb-md">
        <q-btn
          flat
          label="取消定时"
          color="primary"
          @click="clearSleepTimer"
          :disable="!sleepMode"
        />
        <q-btn
          flat
          label="取消"
          color="primary"
          @click="close"
        />
        <q-btn
          flat
          label="确定"
          color="primary"
          @click="confirm"
        />
      </div>

    </q-card>
  </q-dialog>
</template>

<script>
import { mapState, mapMutations } from 'vuex'

export default {
  name: 'SleepMode',

  props: ['modelValue'],

  emits: ['update:modelValue'],
  
  data() {
    return {
      sliderValue: 45,
      trackValue: 0,
      currentMode: 'tracks'
    }
  },

  computed: {
    ...mapState('AudioPlayer', [
      'sleepMode',
      'sleepModeType',
      'sleepStopAt',
      'sleepTracksLeft'
    ]),

    visible: {
      get() {
        return this.modelValue
      },
      set(val) {
        this.$emit('update:modelValue', val)
      }
    },

    sliderLabel() {
      const mins = Math.round(this.sliderValue)
      return `${mins} 分钟`
    },

    minutesHint() {
      const mins = Math.round(this.sliderValue)
      const stopAt = new Date(Date.now() + mins * 60 * 1000)
      const h = stopAt.getHours().toString().padStart(2, '0')
      const m = stopAt.getMinutes().toString().padStart(2, '0')
      return `${mins} 分钟后停止（约 ${h}:${m}）`
    },

    tracksHint() {
      if (this.trackValue === 0) {
        return '当前曲目结束后停止'
      }
      return `当前曲目之后再播放 ${this.trackValue} 首`
    },

    timerStatusText() {
      if (this.sleepModeType === 'minutes' && this.sleepStopAt > Date.now()) {
        const stopAt = new Date(this.sleepStopAt)
        const h = stopAt.getHours().toString().padStart(2, '0')
        const m = stopAt.getMinutes().toString().padStart(2, '0')
        const remaining = this.remainingMinutes
        if (remaining > 0) {
          return `约 ${h}:${m} 停止（还剩 ${remaining} 分钟）`
        }
        return `约 ${h}:${m} 停止`
      }
      if (this.sleepModeType === 'tracks') {
        const left = Math.max(0, this.sleepTracksLeft)
        if (left === 0) {
          return '当前曲目结束后停止'
        }
        return `再播放 ${left} 首后停止`
      }
      return ''
    },

    remainingMinutes() {
      if (!this.sleepStopAt || this.sleepStopAt <= Date.now()) return 0
      return Math.max(0, Math.ceil((this.sleepStopAt - Date.now()) / 60000))
    }
  },

  methods: {
    ...mapMutations('AudioPlayer', [
      'SET_SLEEP_TIMER',
      'CLEAR_SLEEP_MODE'
    ]),

    onVisChange(val) {
      this.$emit('update:modelValue', val)
    },

    clear() {
      this.sliderValue = 45
      this.trackValue = 0
      this.currentMode = 'tracks'
    },

    open() {
      if (this.sleepMode && this.sleepModeType === 'minutes' && this.sleepStopAt) {
        this.sliderValue = Math.round((this.sleepStopAt - Date.now()) / 60000)
        this.currentMode = 'minutes'
      } else if (this.sleepMode && this.sleepModeType === 'tracks') {
        this.trackValue = this.sleepTracksLeft
        this.currentMode = 'tracks'
      }
    },

    confirm() {
      if (this.currentMode === 'minutes') {
        const mins = Math.round(this.sliderValue)
        this.SET_SLEEP_TIMER({
          type: 'minutes',
          stopAt: Date.now() + mins * 60 * 1000
        })
      } else {
        this.SET_SLEEP_TIMER({
          type: 'tracks',
          tracksLeft: this.trackValue
        })
      }
      this.showSuccNotif(this.confirmMsg())
      this.close()
    },

    confirmMsg() {
      if (this.currentMode === 'minutes') {
        const mins = Math.round(this.sliderValue)
        return `将在 ${mins} 分钟后停止播放`
      } else if (this.trackValue === 0) {
        return '当前曲目结束后停止播放'
      }
      return `将在 ${this.trackValue} 首曲目后停止播放`
    },

    close() {
      this.onVisChange(false)
    },

    clearSleepTimer() {
      this.CLEAR_SLEEP_MODE()
      this.showSuccNotif('已关闭睡眠模式')
    },

    fnMarkerLabel(val) {
      return `${val}`
    },

    fnGetRemainingTracks() {
      const queue = this.$store.state.AudioPlayer.queue
      const queueIndex = this.$store.state.AudioPlayer.queueIndex
      return Math.max(0, queue.length - queueIndex - 1)
    },

    showSuccNotif(message) {
      this.$q.notify({
        message,
        color: 'primary',
        icon: 'bedtime',
        timeout: 5000
      })
    }
  },

  mounted() {
    try {
      const saved = this.$q.sessionStorage.getItem('sleepTimer')
      if (saved) {
        if (saved.type === 'minutes' && saved.stopAt && saved.stopAt > Date.now()) {
          this.SET_SLEEP_TIMER({ type: 'minutes', stopAt: saved.stopAt })
        } else if (saved.type === 'tracks' && saved.tracksLeft >= 0) {
          this.SET_SLEEP_TIMER({ type: 'tracks', tracksLeft: saved.tracksLeft })
        } else {
          this.$q.sessionStorage.remove('sleepTimer')
        }
      }
    } catch {
      console.log('Web Storage API error')
    }
  },

  watch: {
    modelValue(visible) {
      this.clear()
      if (visible) this.open()
    }
  }
}
</script>

<style lang="sass" scoped>
.sleep-mode-dialog
  .picker-slider
    width: 100%
    height: 12px

.slider-label-value
  display: inline-block
  min-width: 5em
  text-align: center

.slider-label-desc
  display: block
  margin-top: 4px
</style>
