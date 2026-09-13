<template>
  <div class="row">
      <WorkGallery
        class="col q-ma-md shadow-4"
        :workid="metadata.id"
        :images="images"
        style="border-radius: 8px; overflow: hidden;"
      />

    <div class="col-md-6 col-12 q-pa-md">
      <div class="q-px-sm q-py-none">
        <!-- 标题 -->
        <div class="text-h6 text-weight-regular">
          <router-link :to="`/work/${metadata.id}`" class="text-primary">
            {{metadata.title}}
          </router-link>
        </div>

        <!-- 社团名 -->
        <div class="text-subtitle1 text-weight-regular">
          <SearchableLabel
            :to="labelRoute('circle', metadata.circle.name)"
            field="circle"
            :name="metadata.circle.name || ''"
            link-class="text-muted"
          >
            {{metadata.circle.name}}
          </SearchableLabel>
        </div>


        <!-- 评价&评论 -->
        <div class="row items-center q-gutter-xs">
          <!-- 评价 -->
          <div class="col-auto">
            <q-rating
              v-model="rating"
              @update:model-value="setRating"
              name="rating"
              size="sm"
              :color="userMarked ? 'rating-star' : 'primary'"
              icon="star_border"
              icon-selected="star"
              icon-half="star_half"
            />

            <!-- 评价分布明细 -->
            <q-tooltip v-if=metadata.rate_count_detail content-class="text-subtitle1">
              <div>{{ $t('workdetails.average') }}: {{metadata.rate_average_2dp}}</div>
              <div v-for="(rate, index) in sortedRatings" :key=index class="row items-center">
                <div class="col"> {{ $t('workdetails.stars', { n: rate.review_point }) }} </div>

                <!-- 评价占比 -->
                <q-linear-progress
                  :value="rate.ratio/100"
                  color="on-info-container"
                  track-color="info-container"
                  style="height: 15px; width: 100px"
                  class="col-auto"
                />

                <div class="col q-mx-sm"> ({{rate.count}}) </div>
              </div>
            </q-tooltip>
          </div>

          <div class="col-auto">
            <span class="text-weight-medium text-body1 text-negative">{{metadata.rate_average_2dp}}</span> <span class="text-muted"> ({{metadata.rate_count}})</span>
          </div>

          <!-- 评论数量 -->
          <div class="col-auto q-px-sm">
            <q-icon name="chat" size="xs" /> <span class="text-muted"> ({{metadata.review_count}})</span>
          </div>

          <!-- DLsite链接 -->
          <div class="col-auto">
            <q-icon name="launch" size="xs" /><a class="text-primary" :href="sourceLink" rel="noreferrer noopener" target="_blank">{{sourceLabel}}</a>
          </div>
        </div>
      </div>

      <!-- 价格&售出数 -->
      <div class="q-pt-sm q-pb-none">
        <span class="q-mx-sm text-weight-medium text-h6 text-negative">{{ $t('workdetails.priceYen', { price: metadata.price }) }}</span> {{ $t('workdetails.dlCount', { count: metadata.dl_count }) }}
      </div>

      <!-- 标签 -->
      <div class="q-px-none q-py-sm" v-if="showTags">
        <LabelDropdown
          v-for="(tag, index) in metadata.tags"
          :to="labelRoute('tag', tag.name)"
          field="tag"
          :name="tag.name"
          :label="$tTag(tag.name)"
          :key=index
          dense
          size="md"
          rounded
          color="surface-container"
          text-color="on-surface"
          class="shadow-4 q-ma-xs"
          :lang="$tagLang"
        />
      </div>

      <!-- Voice Actor -->
      <div class="q-px-none q-pb-xs">
        <LabelDropdown
          v-for="(va, index) in metadata.vas"
          :to="labelRoute('va', va.name)"
          field="va"
          :name="va.name"
          :label="va.name"
          :key=index
          dense
          size="md"
          icon="mic"
          color="tertiary-container"
          text-color="on-tertiary-container"
          class="shadow-4 q-ma-xs"
        />
      </div>

      <!-- Illustrator -->
      <!-- <div class="q-px-none q-pb-xs" v-if="metadata.illustrators && metadata.illustrators.length > 0">
        <router-link
          v-for="(illustrator, index) in metadata.illustrators"
          :to="labelRoute('illustrator', illustrator.name)"
          :key=index
        >
          <q-chip square size="md" class="shadow-4" color="tertiary-container" text-color="on-tertiary-container" icon="brush">
            {{illustrator.name}}
          </q-chip>
        </router-link>
      </div> -->

      <!-- Scriptwriter -->
      <div class="q-px-none q-pb-xs" v-if="metadata.scriptWriters && metadata.scriptWriters.length > 0">
        <LabelDropdown
          v-for="(sw, index) in metadata.scriptWriters"
          :to="labelRoute('script_writer', sw.name)"
          field="script_writer"
          :name="sw.name"
          :label="sw.name"
          :key=index
          dense
          size="md"
          icon="edit"
          color="secondary-container"
          text-color="on-secondary-container"
          class="shadow-4 q-ma-xs"
        />
      </div>

      <!-- 系列 -->
      <div class="q-px-none q-pb-xs" v-if="metadata.series">
        <LabelDropdown
          :to="labelRoute('series', metadata.series.name)"
          field="series"
          :name="metadata.series.name"
          :label="metadata.series.name"
          dense
          size="md"
          icon="collections_bookmark"
          color="surface-container-highest"
          text-color="on-surface"
          class="shadow-4 q-ma-xs"
        />
      </div>

      <q-btn-dropdown
        dense
        class="q-mt-sm shadow-4 q-mx-xs q-px-md"
        color="primary"
        text-color="on-primary"
        :label="progressLabel"
      >
        <q-list bordered=false class="progress-menu">
          <q-item clickable @click="setProgress('marked')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'marked'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.marked') }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-item clickable @click="setProgress('listening')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'listening'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.listening') }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('listened')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'listened'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.listened') }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('replay')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'replay'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.replay') }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('postponed')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'postponed'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.postponed') }}</q-item-label>
            </q-item-section>
          </q-item>

          <q-separator />

          <q-item clickable @click="clearProgress" class="text-negative">
            <q-item-section avatar>
              <q-icon  name="remove_circle_outline" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ $t('workdetails.clearProgress') }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>

      <q-btn dense @click="showReviewDialog = true" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="$t('workdetails.writeReview')" />

      <div v-if="metadata.state" class="q-mt-sm q-px-sm">
        <div class="text-caption text-weight-medium text-on-surface-variant">{{ $t('workdetails.lastPlayback') }}</div>
        <div class="text-body2 text-secondary">
          <q-icon name="music_note" size="xs" class="q-mr-xs" />
          {{ currentHistoryTrack }}
        </div>
        <div class="text-caption text-on-surface0-variant">
          {{ $t('workdetails.playedTo', { time: formatSeconds(historySeconds) }) }}
        </div>
      </div>

      <q-btn v-if="metadata.state && playWorkId !== metadata.id" dense @click="resumeThisHistory" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" :label="$t('workdetails.resumeHistory')" />
      <q-btn v-if="metadata.state" dense @click="clearThisHistory" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="$t('workdetails.deleteHistory')">
        <q-tooltip>{{ $t('workdetails.deleteHistoryTooltip') }}</q-tooltip>
      </q-btn>


      <q-btn dense @click="scanWorkFile" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="$t('workdetails.scanFiles')" />

      <q-btn v-if="enableTranscoding" dense :loading="downloadOfflineLoading" @click="toggleWorkOfflineDownload" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="offlineDownloadLabel" />

      <q-btn v-if="isAdmin" dense @click="showEditDialog = true" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="$t('workdetails.editMetadata')" />

      <q-btn dense :loading="refreshMetadataLoading" @click="refreshMetadata" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" :label="$t('workdetails.refreshMetadata')" />

      <WriteReview v-if="showReviewDialog" @closed="processReview" :workid="metadata.id" :metadata="metadata"></WriteReview>

      <EditMetadata v-if="showEditDialog" :metadata="metadata" @saved="onEditSaved" @closed="showEditDialog = false" />
    </div>
  </div>
</template>


<script>
import WorkGallery from 'components/WorkGallery'
import WriteReview from './WriteReview'
import EditMetadata from './EditMetadata'
import SearchableLabel from './SearchableLabel'
import LabelDropdown from './LabelDropdown'
import NotifyMixin from '../mixins/Notification.js'
import { mapState, mapGetters } from 'vuex'
import { isFanzaId, fanzaCid, dlsiteWorkUrl, labelRoute, workno } from 'src/utils'
import { uncacheFile, buildWorkDownloadPlan, startWorkDownload, bgFetchIdFor, canBackgroundFetch } from '../utils/downloads'
import { activeRegistration } from '../utils/service-worker'

export default {
  name: 'WorkDetails',

  mixins: [NotifyMixin],

  components: {
    WorkGallery,
    WriteReview,
    EditMetadata,
    SearchableLabel,
    LabelDropdown
  },

  props: {
    metadata: {
      type: Object,
      required: true
    },

    // Scraped work images (t_work.sample_images); the gallery shows them after
    // the cover.
    images: {
      type: Array,
      required: false,
      default() { return [] }
    },

    // The parked track's position, already reconciled against the local store by
    // Work.vue. null until that resolves; the fallback below covers the gap.
    resumeSeconds: {
      type: Number,
      required: false,
      default: null
    }
  },

  data() {
    return {
      refreshMetadataLoading: false,
      downloadOfflineLoading: false,
      // { done, total } while a foreground download runs. Null on the background
      // path, where the browser's own notification carries the progress.
      downloadProgress: null,
      userMarked: false,
      rating: 0,
      progress: '',
      showReviewDialog: false,
      showEditDialog: false,
      showTags: true
    }
  },

  computed: {
    sortedRatings: function() {
      function compare(a, b) {
        return (a.review_point > b.review_point) ? -1 : 1;
      }
      return this.metadata.rate_count_detail.slice().sort(compare);
    },

    progressLabel() {
      const labels = {
        marked: this.$t('workdetails.marked'),
        listening: this.$t('workdetails.listening'),
        listened: this.$t('workdetails.listened'),
        replay: this.$t('workdetails.replay'),
        postponed: this.$t('workdetails.postponed')
      };
      return labels[this.progress] || this.$t('workdetails.markProgress');
    },
    
    isFanza() {
      return isFanzaId(this.metadata.id);
    },

    sourceLink() {
      if (this.isFanza) {
        return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${fanzaCid(this.metadata.id)}/`;
      }
      return dlsiteWorkUrl(this.metadata.id);
    },

    sourceLabel() {
      return this.isFanza ? 'Fanza' : 'DLsite';
    },

    currentHistoryTrack() {
      const state = this.metadata.state
      if (!state || !state.queue || state.queue.length === 0) return '—'
      const idx = Math.min(state.index ?? 0, state.queue.length - 1)
      const track = state.queue[idx]
      return track ? (track.title || '—') : '—'
    },

    // Reconciled against the local store by the parent, so this reads the same
    // number the file tree shows. Reading metadata.state.seconds directly is
    // what made the panel and the tree disagree.
    historySeconds() {
      return this.resumeSeconds ?? this.metadata.state?.seconds ?? 0
    },

    isAdmin() {
      return !this.$store.state.User.auth || this.$store.state.User.group === 'administrator' || this.$store.state.User.name === 'admin';
    },

    ...mapState('AudioPlayer', [
      'playing',
      'playWorkId'
    ]),

    ...mapState('Downloads', [
      'enableTranscoding',
    ]),

    ...mapGetters('Downloads', [
      'isWorkDownloaded',
      'isWorkDownloading',
    ]),

    // Three states, not two: a Background Fetch keeps running after this page
    // is closed, so "downloading" has to be visible on return.
    offlineDownloadLabel () {
      // A foreground download is watched rather than backgrounded, so its
      // progress goes on the button -- there is no OS notification for it.
      if (this.downloadProgress) {
        return this.$t('workdetails.downloadOfflineProgress', this.downloadProgress);
      }
      if (this.isWorkDownloading(this.metadata.id)) return this.$t('workdetails.downloadOfflineInProgress');
      if (this.isWorkDownloaded(this.metadata.id)) return this.$t('workdetails.removeOfflineDownload');
      return this.$t('workdetails.downloadOffline');
    },
  },

  watch: {
    // 需要用watch因为父component pages/work.vue是先用空值初始化的
    metadata (newMetaData) {
      if (newMetaData.userRating) {
        this.userMarked = true;
        this.rating = newMetaData.userRating;
      } else {
        this.userMarked = false;
        this.rating = newMetaData.rate_average_2dp || 0;
      }
      this.progress = newMetaData.progress;

      // 极个别作品没有标签
      if (newMetaData.tags && newMetaData.tags.length > 0 && newMetaData.tags[0].name === null) {
        this.showTags = false;
      }
    },
  },

  methods: {
    labelRoute,
    setProgress (newProgress) {
      this.progress = newProgress;
      const submitPayload = {
        'user_name': this.$store.state.User.name, // 用户名不会被后端使用
        'progress': newProgress
      };
      this.submitProgress(submitPayload);
    },

    submitProgress (payload) {
      const params = {
        starOnly: false,
        progressOnly: true
      }
      this.$axios.put(`/api/review/${this.metadata.id}`, payload, {params})
        .then((response) => {
          this.showSuccNotif(response.data.message);
          this.$emit('reset');
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    // 只清除进度，保留评分与评论。仅 progress 的行会被后端整行删除。
    clearProgress () {
      this.$q.dialog({
        title: this.$t('workdetails.clearProgress'),
        message: this.$t('workdetails.clearProgressMessage'),
        cancel: this.$t('common.cancel'),
        ok: this.$t('common.ok'),
        persistent: true
      }).onOk(() => {
        this.$axios.delete(`/api/review/${this.metadata.id}/progress`)
          .then((response) => {
            this.showSuccNotif(response.data.message)
            this.$emit('reset')
          })
          .catch((error) => {
            if (error.response) {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            } else {
              this.showErrNotif(error.message || error)
            }
          })
      })
    },

    setRating (newRating) {
      const submitPayload = {
        'user_name': this.$store.state.User.name, // 用户名不会被后端使用
        'rating': newRating
      };
      this.submitRating(submitPayload);
    },

    submitRating (payload) {
      this.$axios.put(`/api/review/${this.metadata.id}`, payload)
        .then((response) => {
          this.showSuccNotif(response.data.message);
          this.$emit('reset');
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    processReview () {
      this.showReviewDialog = false;
    },

    onEditSaved () {
      this.showEditDialog = false;
      this.$emit('reset');
    },

    resumeThisHistory() {
      this.$emit("resumeHistory")
    },

    clearThisHistory() {
      this.$q.dialog({
        title: this.$t('common.notice'),
        message: this.$t('workdetails.deleteHistoryConfirm'),
        cancel: this.$t('common.cancel'),
        ok: this.$t('common.ok')
      }).onOk(async () => {
        this.$axios.delete(`/api/history/${this.metadata.id}`)
          .then((_) => {
            this.$q.notify(this.$t('workdetails.deleteHistorySuccess'))
          })
          .catch((err) => {
            this.$q.notify(this.$t('workdetails.deleteHistoryFail') + err.message)
            console.error(err)
          })
      })
    },

    async scanWorkFile() {
      try {
        const response = await this.$axios.post(`/api/scan/${this.metadata.id}`);
        // `files` is the re-listed track count. Was `memo`, which is gone --
        // durations and the listing both live in t_work_file now.
        if (typeof response.data.files === 'number') {
          this.$router.go(0);
        }
      } catch(err) {
        console.error(err);
        this.showErrNotif(err.message || err);
      }
    },

    async refreshMetadata() {
      this.refreshMetadataLoading = true;
      try {
        await this.$axios.post(`/api/refresh/${this.metadata.id}`);
        this.showSuccNotif(this.$t('workdetails.refreshMetadataSuccess'));
        this.$emit('reset');
      } catch(err) {
        console.error(err);
        this.showErrNotif(err.response?.data?.error || err.message || err);
      } finally {
        this.refreshMetadataLoading = false;
      }
    },

    formatSeconds(totalSeconds) {
      if (totalSeconds == null || totalSeconds < 0) return '—'
      const mins = Math.floor(totalSeconds / 60)
      const secs = Math.floor(totalSeconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    },

    // Pulls in everything needed to fully use this work offline: audio
    // tracks, lyric/subtitle files, the cover image, and the JSON metadata
    // Work.vue/WorkDetails.vue need to render -- not just the audio. See
    // frontend/CLAUDE.md for why the metadata JSON is included too.
    //
    // The download itself runs as a Background Fetch: this method returns as
    // soon as it is registered, and the service worker finishes the job even
    // if the tab is closed.
    async toggleWorkOfflineDownload() {
      const workId = this.metadata.id;

      if (this.isWorkDownloaded(workId) || this.isWorkDownloading(workId)) {
        // Cancel first if a fetch is still running, otherwise the browser
        // keeps downloading a work the user just removed.
        if (this.isWorkDownloading(workId)) {
          // Only a background fetch can be running to abort; a foreground one
          // owns the page, so there is no tab left to press this button in.
          const registration = await activeRegistration();
          if (registration && 'backgroundFetch' in registration) {
            const running = await registration.backgroundFetch.get(bgFetchIdFor(workId));
            if (running) await running.abort();
          }
        }

        const filesToRemove = this.$store.state.Downloads.downloadedFiles.filter(f => f.workId === workId);
        for (const file of filesToRemove) {
          await uncacheFile(file.url);
        }
        this.$store.commit('Downloads/REMOVE_DOWNLOADED_FILES', filesToRemove.map(f => f.url));
        return;
      }

      this.downloadOfflineLoading = true;
      this.downloadProgress = null;
      try {
        // Without Background Fetch the download lives in this page, so leaving it
        // abandons the download. Say so before starting rather than letting the
        // user discover it by navigating away.
        if (!(await canBackgroundFetch())) {
          this.showSuccNotif(this.$t('workdetails.downloadOfflineForeground'));
        }
        const tracksResponse = await this.$axios.get(`/api/tracks/${workId}`);
        const tree = tracksResponse.data.tree || tracksResponse.data;
        const rows = buildWorkDownloadPlan(workId, tree);

        // Claim every row up front, pending. The page is the only side that
        // knows track titles, and the download completes in the service worker
        // -- possibly with no tab open -- so the manifest is written here and
        // promoted later rather than being built as files arrive.
        for (const row of rows) {
          this.$store.commit('Downloads/ADD_DOWNLOADED_FILE', {
            ...row,
            workId,
            workTitle: this.metadata.title,
            bytes: 0,
            downloadedAt: Date.now(),
            pending: true,
          });
        }

        let result;
        try {
          result = await startWorkDownload({
            workId,
            workTitle: this.metadata.title,
            rows,
            title: this.$t('workdetails.downloadOfflineNotificationTitle', { title: this.metadata.title }),
            // Only fires on the foreground path; the background one reports
            // progress through the browser's own notification instead.
            onProgress: ({ done, total }) => { this.downloadProgress = { done, total }; },
          });
        } catch (err) {
          // Nothing will promote these rows -- either the fetch never started or
          // the foreground run failed and rolled its own bytes back.
          this.$store.commit('Downloads/REMOVE_DOWNLOADED_FILES', rows.map(r => r.url));
          throw err;
        }

        if (result.mode === 'foreground') {
          // Already finished by the time we get here, and no service worker will
          // post a completion message -- so promote the rows directly.
          this.$store.commit('Downloads/PROMOTE_DOWNLOADED_FILES', result.stored);
          this.showSuccNotif(this.$t('workdetails.downloadOfflineComplete', { title: this.metadata.title }));
        } else {
          this.showSuccNotif(this.$t('workdetails.downloadOfflineStarted'));
        }
      } catch(err) {
        console.error(err);
        this.showErrNotif(err.message || err);
      } finally {
        this.downloadOfflineLoading = false;
        this.downloadProgress = null;
      }
    },
  }
}
</script>
