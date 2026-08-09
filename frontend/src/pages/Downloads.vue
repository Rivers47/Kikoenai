<template>
  <q-page class="q-pa-md">
    <div class="text-h6 q-mb-sm">{{ $t('downloads.title') }}</div>

    <q-linear-progress
      v-if="storageQuota > 0"
      :value="storageUsage / storageQuota"
      size="10px"
      color="primary"
      class="q-mb-xs"
    />
    <div v-if="storageQuota > 0" class="text-caption text-on-surface-variant q-mb-md">
      {{ $t('downloads.storageUsed', { used: formatBytes(storageUsage), quota: formatBytes(storageQuota) }) }}
    </div>

    <div v-if="downloadedTracks.length === 0" class="text-center text-on-surface-variant q-pa-xl">
      {{ $t('downloads.empty') }}
    </div>

    <q-list v-else separator bordered>
      <q-item v-for="file in downloadedTracks" :key="file.url" clickable @click="play(file)">
        <q-item-section>
          <q-item-label>{{ file.title }}</q-item-label>
          <q-item-label caption>{{ file.workTitle }} &middot; {{ formatBytes(file.bytes) }}</q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat round dense icon="delete" color="negative" @click.stop="remove(file)" />
        </q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script>
import { mapGetters } from 'vuex'
import { uncacheFile } from '../utils/downloads'

function formatBytes (bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export default {
  name: 'Downloads',

  data () {
    return {
      storageUsage: 0,
      storageQuota: 0,
    }
  },

  computed: {
    ...mapGetters('Downloads', [
      'downloadedTracks',
    ]),
  },

  methods: {
    formatBytes,

    play (file) {
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: file.workId,
        queue: [{ trackId: file.trackId, title: file.title, workTitle: file.workTitle }],
        index: 0,
        resetPlaying: true,
      })
    },

    async remove (file) {
      await uncacheFile(file.url)
      this.$store.commit('Downloads/REMOVE_DOWNLOADED_FILE', file.url)
    },

    async updateStorageEstimate () {
      // Feature-detect: unsupported on some Safari versions -- degrade silently.
      if (!navigator.storage || !navigator.storage.estimate) return
      const { usage, quota } = await navigator.storage.estimate()
      this.storageUsage = usage || 0
      this.storageQuota = quota || 0
    },
  },

  mounted () {
    this.updateStorageEstimate()
    // Best-effort: reduces (doesn't guarantee) eviction risk under storage
    // pressure. No-op / silently ignored where unsupported.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist()
    }
  },
}
</script>
