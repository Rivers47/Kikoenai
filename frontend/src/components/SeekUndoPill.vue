<template>
  <transition name="seek-undo">
    <button v-if="visible" type="button" class="seek-undo" @click="undo">
      <q-icon name="undo" size="18px" />
      <span class="seek-undo__label">{{ t('seekundo.back', { time: formatSeconds(seekUndo.time) }) }}</span>
    </button>
  </transition>
</template>

<script>
import { useI18n } from 'vue-i18n'
import { mapState, mapMutations } from 'vuex'
import { useSeekUndo } from 'src/utils/seek-undo'
import { formatSeconds } from '../utils'

export default {
  name: 'SeekUndoPill',

  setup () {
    const { t } = useI18n() // global scope
    const { visible } = useSeekUndo()
    return { t, visible }
  },

  computed: {
    ...mapState('AudioPlayer', ['seekUndo']),
  },

  methods: {
    ...mapMutations('AudioPlayer', {
      setNewCurrentTime: 'SET_NEW_CURRENT_TIME',
      clearSeekUndo: 'CLEAR_SEEK_UNDO',
    }),

    formatSeconds,

    undo () {
      this.setNewCurrentTime(this.seekUndo.time)
      this.clearSeekUndo()
    },
  },
}
</script>

<style lang="scss">
/* Inverse surface, so the pill reads as a snackbar in both themes. */
.seek-undo {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px 0 14px;
  border: 0;
  border-radius: 20px;
  background-color: rgb(var(--inverse-surface-rgb));
  color: rgb(var(--inverse-on-surface-rgb));
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}

.seek-undo__label {
  font-variant-numeric: tabular-nums;
}

.seek-undo-enter-active,
.seek-undo-leave-active {
  transition: opacity 200ms, transform 200ms;
}

.seek-undo-enter-from,
.seek-undo-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
