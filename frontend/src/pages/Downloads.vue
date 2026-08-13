<template>
  <q-page class="q-pa-md">
    <!-- 标题 & 存储用量 -->
    <div class="row items-center q-mb-sm">
      <span class="text-h5 text-weight-regular q-pa-xs relative-position">
        {{ $t('downloads.title') }}
        <q-badge color="secondary" floating>{{ downloadedWorks.length }}</q-badge>
      </span>
    </div>

    <q-linear-progress
      v-if="storageQuota > 0"
      :value="storageUsage / storageQuota"
      size="10px"
      color="primary"
      class="q-mb-xs"
    />
    <div class="text-caption text-on-surface-variant q-mb-md">
      <span v-if="storageQuota > 0">
        {{ $t('downloads.storageUsed', { used: formatBytes(storageUsage), quota: formatBytes(storageQuota) }) }}
        &middot;
      </span>
      {{ $t('downloads.totalDownloaded', { size: formatBytes(totalDownloadedBytes) }) }}
    </div>

    <div v-if="downloadedWorks.length === 0" class="text-center text-on-surface-variant q-pa-xl">
      {{ $t('downloads.empty') }}
    </div>

    <template v-else>
      <!-- 排序 & 显示模式 -->
      <div class="row justify-between items-center q-mb-md q-gutter-sm">
        <q-select
          dense
          rounded
          outlined
          transition-show="scale"
          transition-hide="scale"
          v-model="sortBy"
          :options="sortOptions"
          :option-label="humanReadableLabel"
          :label="$t('downloads.sortBy')"
          class="col-auto"
        />

        <q-btn-toggle
          dense
          spread
          rounded
          v-model="listMode"
          toggle-color="primary"
          color="white"
          text-color="primary"
          :options="[
            { icon: 'apps', value: false },
            { icon: 'list', value: true }
          ]"
          style="width: 85px;"
          class="col-auto"
        />
      </div>

      <!-- WorkCard reads the rating in its own mounted(), so cards must not be
           mounted against the placeholder metadata -- wait for the fetch. -->
      <div v-if="metadataLoading" class="row justify-center q-my-xl">
        <q-spinner-dots color="primary" size="40px" />
      </div>

      <!-- 列表模式 -->
      <q-list v-else-if="listMode" bordered separator class="shadow-2">
        <div v-for="work in sortedWorks" :key="work.workId">
          <WorkListItem :metadata="cardMetadata(work)" :cover-url="work.thumbUrl" :showLabel="false">
            <template v-slot:side>
              <div class="row items-center no-wrap">
                <span class="text-caption text-on-surface-variant q-mr-sm gt-xs">{{ workSummary(work) }}</span>
                <q-btn flat round dense icon="play_arrow" color="primary" @click.stop.prevent="playWork(work)">
                  <q-tooltip>{{ $t('downloads.playAll') }}</q-tooltip>
                </q-btn>
                <q-btn
                  flat
                  round
                  dense
                  :icon="isExpanded(work) ? 'expand_less' : 'expand_more'"
                  @click.stop.prevent="toggleExpand(work)"
                >
                  <q-tooltip>{{ isExpanded(work) ? $t('downloads.hideTracks') : $t('downloads.showTracks') }}</q-tooltip>
                </q-btn>
                <q-btn flat round dense icon="delete" color="negative" @click.stop.prevent="removeWork(work)">
                  <q-tooltip>{{ $t('downloads.removeWork') }}</q-tooltip>
                </q-btn>
              </div>
            </template>
          </WorkListItem>

          <q-slide-transition>
            <div v-show="isExpanded(work)">
              <q-list dense class="bg-surface-container-highest">
                <q-item
                  v-for="(file, index) in work.tracks"
                  :key="file.url"
                  clickable
                  @click="playWork(work, index)"
                >
                  <q-item-section side>
                    <q-icon name="play_arrow" size="xs" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label lines="1">{{ file.title }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <div class="row items-center no-wrap">
                      <span class="text-caption text-on-surface-variant q-mr-sm">{{ formatBytes(file.bytes) }}</span>
                      <q-btn flat round dense icon="delete" color="negative" @click.stop="removeFile(file)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
          </q-slide-transition>
        </div>
      </q-list>

      <!-- 卡片模式 -->
      <div v-else class="row q-col-gutter-x-md q-col-gutter-y-lg">
        <div
          class="col-xs-12 col-sm-6 col-md-4 col-lg-3 col-xl-2"
          v-for="work in sortedWorks"
          :key="work.workId"
          style="--sim-hover-work-card: 0"
        >
          <WorkCard :metadata="cardMetadata(work)" :cover-url="work.coverUrl" />

          <!-- 下载信息栏 -->
          <div class="row items-center justify-between q-mt-xs q-px-sm">
            <span class="col-auto text-caption text-on-surface-variant">{{ workSummary(work) }}</span>
            <div class="col-auto row items-center no-wrap">
              <q-btn flat round dense icon="play_arrow" color="primary" @click="playWork(work)">
                <q-tooltip>{{ $t('downloads.playAll') }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                :icon="isExpanded(work) ? 'expand_less' : 'expand_more'"
                @click="toggleExpand(work)"
              >
                <q-tooltip>{{ isExpanded(work) ? $t('downloads.hideTracks') : $t('downloads.showTracks') }}</q-tooltip>
              </q-btn>
              <q-btn flat round dense icon="delete" color="negative" @click="removeWork(work)">
                <q-tooltip>{{ $t('downloads.removeWork') }}</q-tooltip>
              </q-btn>
            </div>
          </div>

          <q-slide-transition>
            <div v-show="isExpanded(work)">
              <q-list dense bordered class="q-mt-xs rounded-borders">
                <q-item
                  v-for="(file, index) in work.tracks"
                  :key="file.url"
                  clickable
                  @click="playWork(work, index)"
                >
                  <q-item-section side>
                    <q-icon name="play_arrow" size="xs" />
                  </q-item-section>
                  <q-item-section>
                    <q-item-label lines="1">{{ file.title }}</q-item-label>
                    <q-item-label caption>{{ formatBytes(file.bytes) }}</q-item-label>
                  </q-item-section>
                  <q-item-section side>
                    <q-btn flat round dense icon="delete" color="negative" @click.stop="removeFile(file)" />
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
          </q-slide-transition>
        </div>
      </div>
    </template>
  </q-page>
</template>

<script>
import { mapGetters, mapState } from 'vuex'
import WorkCard from 'components/WorkCard'
import WorkListItem from 'components/WorkListItem'
import { uncacheFile } from '../utils/downloads'
import { pendingProgress } from '../utils/outbox'

// Own LocalStorage keys -- deliberately NOT the Works page's `listMode` /
// `sortCategoryOption`, so the two pages keep independent view preferences.
const LIST_MODE_KEY = 'downloads_list_mode'
const SORT_BY_KEY = 'downloads_sort_by'

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

  components: {
    WorkCard,
    WorkListItem,
  },

  data () {
    return {
      storageUsage: 0,
      storageQuota: 0,
      listMode: false,
      sortBy: 'downloadedAt',
      sortOptions: ['downloadedAt', 'title', 'size'],
      expandedWorkIds: [],
      metadataLoading: false,
      // workId -> /api/work/:id response, or null when it couldn't be fetched
      // (offline and never cached). Cards fall back to a stub in that case.
      metadataByWorkId: {},
    }
  },

  computed: {
    ...mapState('Downloads', [
      'downloadedFiles',
    ]),

    ...mapGetters('Downloads', [
      'totalDownloadedBytes',
    ]),

    // Groups the flat manifest by work, keeping manifest order within a work --
    // entries are committed in tree-walk order, so that's the track order.
    downloadedWorks () {
      const byWorkId = new Map()

      // Skip `pending` rows: a whole-work Background Fetch claims its manifest
      // rows up front, before the bytes are in Cache Storage. Listing those
      // here would offer works that cannot actually be played offline yet.
      for (const file of this.downloadedFiles.filter(f => !f.pending)) {
        let work = byWorkId.get(file.workId)
        if (!work) {
          work = {
            workId: file.workId,
            workTitle: file.workTitle,
            tracks: [],
            lyricCount: 0,
            bytes: 0,
            coverUrl: '',
            thumbUrl: '',
            downloadedAt: 0,
          }
          byWorkId.set(file.workId, work)
        }

        work.bytes += file.bytes || 0
        work.downloadedAt = Math.max(work.downloadedAt, file.downloadedAt || 0)

        if (file.type === 'audio') {
          work.tracks.push(file)
        } else if (file.type === 'lyric') {
          work.lyricCount += 1
        } else if (file.type === 'cover') {
          if (file.url.endsWith('?type=main')) {
            work.coverUrl = file.url
          } else if (file.url.endsWith('?type=sam')) {
            work.thumbUrl = file.url
          }
        }
      }

      // Point both cover slots at whichever variant was actually cached: works
      // downloaded before the three-variant change only have ?type=main.
      for (const work of byWorkId.values()) {
        if (!work.coverUrl) work.coverUrl = `/api/cover/${work.workId}?type=main`
        if (!work.thumbUrl) work.thumbUrl = work.coverUrl
      }

      return Array.from(byWorkId.values())
    },

    sortedWorks () {
      const works = this.downloadedWorks.concat()
      switch (this.sortBy) {
        case 'title':
          return works.sort((a, b) => this.workTitleOf(a).localeCompare(this.workTitleOf(b)))
        case 'size':
          return works.sort((a, b) => b.bytes - a.bytes)
        default:
          return works.sort((a, b) => b.downloadedAt - a.downloadedAt)
      }
    },
  },

  watch: {
    listMode (value) {
      this.$q.localStorage.set(LIST_MODE_KEY, value)
    },

    sortBy (value) {
      this.$q.localStorage.set(SORT_BY_KEY, value)
    },

    downloadedWorks () {
      this.fetchMetadata()
    },
  },

  methods: {
    formatBytes,

    // Live metadata when online, the SW's cached copy when offline; the stub
    // keeps the card renderable when neither is available. Omitting
    // rate_count_detail is what keeps WorkCard's rating tooltip hidden.
    cardMetadata (work) {
      const metadata = this.metadataByWorkId[work.workId]
      if (metadata) return metadata

      return {
        id: work.workId,
        title: work.workTitle,
        circle: { id: 0, name: '' },
        tags: [],
        vas: [],
        release: '',
        price: 0,
        dl_count: 0,
        rate_average_2dp: 0,
        rate_count: 0,
        review_count: 0,
        nsfw: true,
      }
    },

    workTitleOf (work) {
      const metadata = this.metadataByWorkId[work.workId]
      return (metadata && metadata.title) || work.workTitle || ''
    },

    workSummary (work) {
      const parts = [this.$t('downloads.trackCount', { count: work.tracks.length })]
      if (work.lyricCount > 0) {
        parts.push(this.$t('downloads.lyricCount', { count: work.lyricCount }))
      }
      parts.push(formatBytes(work.bytes))
      return parts.join(' · ')
    },

    isExpanded (work) {
      return this.expandedWorkIds.includes(work.workId)
    },

    toggleExpand (work) {
      if (this.isExpanded(work)) {
        this.expandedWorkIds = this.expandedWorkIds.filter(id => id !== work.workId)
      } else {
        this.expandedWorkIds = this.expandedWorkIds.concat(work.workId)
      }
    },

    // Failures are expected (offline, work deleted server-side) -- fall back to
    // the stub silently instead of a wall of error notifications.
    fetchMetadata () {
      const pending = this.downloadedWorks
        .filter(work => !(work.workId in this.metadataByWorkId))
        .map(work => this.$axios.get(`/api/work/${work.workId}`)
          .then((response) => {
            this.metadataByWorkId[work.workId] = response.data
          })
          .catch(() => {
            this.metadataByWorkId[work.workId] = null
          }))

      // Nothing new to fetch (e.g. re-entered after a delete): don't flip the
      // loading flag, which would needlessly remount every card.
      if (pending.length === 0) return Promise.resolve()

      this.metadataLoading = true
      return Promise.all(pending).finally(() => {
        this.metadataLoading = false
      })
    },

    async playWork (work, index = 0) {
      if (work.tracks.length === 0) return

      const metadata = this.metadataByWorkId[work.workId]
      // contentHash and duration come from the manifest: without them the
      // player reports no progress and shows no track length, and offline
      // there is no tree to recover them from. Manifests written before they
      // were recorded simply lack them, as they did before.
      const queue = work.tracks.map(file => ({
        trackId: file.trackId,
        title: file.title,
        workTitle: work.workTitle,
        contentHash: file.contentHash,
        duration: file.duration,
      }))

      const progress = await pendingProgress(work.workId)
      const resume = queue[index] && progress[queue[index].contentHash]

      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: work.workId,
        vas: (metadata && metadata.vas) || [],
        queue,
        index,
        resetPlaying: true,
        resumeHistorySeconds: resume ? resume.seconds : -1,
        workLastTrackId: queue[queue.length - 1].trackId,
      })
    },

    removeWork (work) {
      this.$q.dialog({
        title: this.$t('downloads.removeWork'),
        message: this.$t('downloads.removeWorkConfirm', { title: this.workTitleOf(work) }),
        cancel: this.$t('common.cancel'),
        ok: this.$t('common.delete'),
        persistent: true,
      }).onOk(async () => {
        const filesToRemove = this.downloadedFiles.filter(f => f.workId === work.workId)
        for (const file of filesToRemove) {
          await uncacheFile(file.url)
          this.$store.commit('Downloads/REMOVE_DOWNLOADED_FILE', file.url)
        }
        this.updateStorageEstimate()
      })
    },

    async removeFile (file) {
      await uncacheFile(file.url)
      this.$store.commit('Downloads/REMOVE_DOWNLOADED_FILE', file.url)
      this.updateStorageEstimate()
    },

    humanReadableLabel (label) {
      switch (label) {
        case 'downloadedAt': return this.$t('downloads.sortDownloadedAt')
        case 'title': return this.$t('downloads.sortTitle')
        case 'size': return this.$t('downloads.sortSize')
        default: return label
      }
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
    if (this.$q.localStorage.has(LIST_MODE_KEY)) {
      this.listMode = this.$q.localStorage.getItem(LIST_MODE_KEY)
    }
    if (this.$q.localStorage.has(SORT_BY_KEY)) {
      this.sortBy = this.$q.localStorage.getItem(SORT_BY_KEY)
    }

    this.fetchMetadata()
    this.updateStorageEstimate()
    // Best-effort: reduces (doesn't guarantee) eviction risk under storage
    // pressure. No-op / silently ignored where unsupported.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist()
    }
  },
}
</script>
