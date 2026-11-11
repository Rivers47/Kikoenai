import { computed } from 'vue'
import { useStore } from 'vuex'
import { SEEK_UNDO_PILL_MS } from 'src/store/module-AudioPlayer/state'
import { useNow } from './now'

/**
 * The seek-undo pill and the ghost marker on the seek bars share one condition:
 * a remembered position that has not expired yet. Both are derived from
 * `seekUndo.at`, so they appear and disappear together.
 */
export function useSeekUndo () {
  const store = useStore()
  const now = useNow()

  const seekUndo = computed(() => store.state.AudioPlayer.seekUndo)
  const duration = computed(() => store.state.AudioPlayer.duration)

  const visible = computed(() => Boolean(seekUndo.value) && now.value - seekUndo.value.at < SEEK_UNDO_PILL_MS)

  const percent = computed(() => {
    if (!seekUndo.value || !duration.value) return 0
    return Math.min(100, Math.max(0, (seekUndo.value.time / duration.value) * 100))
  })

  return { seekUndo, visible, percent }
}
